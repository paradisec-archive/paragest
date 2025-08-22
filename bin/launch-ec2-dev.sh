#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Launching EC2 instance in Paragest VPC with EFS mount${NC}"

ENV=$1
if [ -z "$ENV" ]; then
  echo -e "${RED}Error: Environment argument is required (e.g., dev, staging, prod)${NC}"

  exit 1
fi

export AWS_PROFILE="nabu-${ENV}"

echo -e "${YELLOW}📋 Retrieving infrastructure details...${NC}"

VPC_ID=$(aws ssm get-parameter --name "/paragest/resources/vpc-id" --query Parameter.Value --output text)
echo "VPC ID: $VPC_ID"

SUBNET_ID=$(aws ssm get-parameter --name "/paragest/resources/subnets/private/apse2a-id" --query Parameter.Value --output text)
echo "Subnet ID: $SUBNET_ID"

EFS_ID=$(aws efs describe-file-systems --query "FileSystems[?Name=='ParagestStack/FargateFileSystem'].FileSystemId" --output text)
echo "EFS ID: $EFS_ID"

ACCESS_POINT_ID=$(aws efs describe-access-points --query "AccessPoints[?FileSystemId=='${EFS_ID}'].AccessPointId" --output text)
echo "EFS Access Point ID: $ACCESS_POINT_ID"

MOUNT_TARGET_ID=$(aws efs describe-mount-targets --file-system-id "$EFS_ID" --query "MountTargets[?AvailabilityZoneName=='ap-southeast-2a'].MountTargetId" --output text)
EFS_SECURITY_GROUP_ID=$(aws efs describe-mount-target-security-groups --mount-target-id "${MOUNT_TARGET_ID}" --query SecurityGroups --output text)
echo "EFS Security Group ID: $EFS_SECURITY_GROUP_ID"

echo -e "${YELLOW}🔐 Creating EC2 security group...${NC}"
EC2_SECURITY_GROUP_ID=$(aws ec2 create-security-group \
  --group-name "paragest-ec2-dev-$(date +%Y%m%d-%H%M)" \
  --description "Security group for Paragest development EC2 instance" \
  --vpc-id "$VPC_ID" \
  --query 'GroupId' \
  --output text)
echo "EC2 Security Group ID: $EC2_SECURITY_GROUP_ID"

echo -e "${YELLOW}🔗 Adding inbound rule to EFS security group...${NC}"
aws ec2 authorize-security-group-ingress \
  --group-id "$EFS_SECURITY_GROUP_ID" \
  --protocol tcp \
  --port 2049 \
  --source-group "$EC2_SECURITY_GROUP_ID"
echo "Added NFS access rule from EC2 to EFS security group"

echo -e "${YELLOW}🔍 Finding latest Amazon Linux AMI...${NC}"
AMI_ID=$(aws ssm get-parameters --names \
  /aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2 \
  --query "Parameters[0].Value" \
  --output text)
echo "Amazon Linux AMI ID: $AMI_ID"

echo -e "${YELLOW}🔑 Finding SSH key pair...${NC}"
KEY_NAME=$(aws ec2 describe-key-pairs --query 'KeyPairs[0].KeyName' --output text)
echo "Using key pair: $KEY_NAME"

echo -e "${YELLOW}🔐 Creating IAM role for EC2 instance...${NC}"
TIMESTAMP=$(date +%Y%m%d-%H%M)
ROLE_NAME="paragest-ec2-dev-role-${TIMESTAMP}"
INSTANCE_PROFILE_NAME="paragest-ec2-dev-profile-${TIMESTAMP}"

# Create IAM role
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "ec2.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'
echo "Created IAM role: $ROLE_NAME"

# Create instance profile
aws iam create-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME"
echo "Created instance profile: $INSTANCE_PROFILE_NAME"

# Add role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE_NAME" \
  --role-name "$ROLE_NAME"
echo "Added role to instance profile"

# Attach managed policies
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
echo "Attached AmazonSSMManagedInstanceCore policy"

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
echo "Attached CloudWatchAgentServerPolicy policy"

# Create and attach EFS access policy
EFS_POLICY_NAME="paragest-efs-access-${TIMESTAMP}"
EFS_POLICY_DOCUMENT=$(
  cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
        "elasticfilesystem:DescribeMountTargets",
        "elasticfilesystem:DescribeAccessPoints",
        "elasticfilesystem:DescribeFileSystems"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

EFS_POLICY_ARN=$(aws iam create-policy \
  --policy-name "$EFS_POLICY_NAME" \
  --policy-document "$EFS_POLICY_DOCUMENT" \
  --query 'Policy.Arn' \
  --output text)
echo "Created EFS policy: $EFS_POLICY_NAME"

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "$EFS_POLICY_ARN"
echo "Attached EFS policy to role"

echo -e "${YELLOW}⏳ Waiting for instance profile to be ready...${NC}"
sleep 10

PASSWORD=$(openssl rand -base64 12)

# Create user data script
USER_DATA=$(
  cat <<EOF
#!/bin/bash

echo 'ec2-user:${PASSWORD}' | chpasswd

yum update -y
yum install -y amazon-efs-utils

# Create mount point
mkdir -p /mnt/efs

# Mount EFS using access point
echo "${EFS_ID} /mnt/efs efs defaults,_netdev,tls,iam,accesspoint=${ACCESS_POINT_ID}" >> /etc/fstab

# Mount now
mount -a

# Set permissions
chown ec2-user:ec2-user /mnt/efs
chmod 755 /mnt/efs
EOF
)

USER_DATA_B64=$(echo "$USER_DATA" | base64 -w 0)

echo -e "${YELLOW}🖥️  Launching EC2 instance...${NC}"

# Launch EC2 instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --count 1 \
  --instance-type t3.micro \
  --key-name "$KEY_NAME" \
  --security-group-ids "$EC2_SECURITY_GROUP_ID" \
  --iam-instance-profile Name="$INSTANCE_PROFILE_NAME" \
  --subnet-id "$SUBNET_ID" \
  --user-data "$USER_DATA_B64" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=paragest-dev-$(date +%Y%m%d-%H%M)},{Key=uni:billing:application,Value=para}]" \
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
  --query 'Instances[0].InstanceId' \
  --output text)

echo -e "${GREEN}✅ Instance launched: $INSTANCE_ID${NC}"

echo -e "${YELLOW}⏳ Waiting for instance to be running...${NC}"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

echo -e "${YELLOW}⏳ Waiting for user data setup to complete...${NC}"
sleep 60

echo -e "${GREEN}🎉 Instance is ready!${NC}"
echo
echo -e "${YELLOW}📝 Instance Details:${NC}"
echo "Instance ID: $INSTANCE_ID"
echo "Environment: $ENV"
echo "EFS Mount Point: /mnt/efs"
echo "Password: ${PASSWORD}"
echo "EC2 Security Group: $EC2_SECURITY_GROUP_ID"
echo "IAM Role: $ROLE_NAME"
echo "IAM Instance Profile: $INSTANCE_PROFILE_NAME"
echo "EFS Policy: $EFS_POLICY_NAME"
echo
echo -e "${YELLOW}🔗 To connect via SSH:${NC}"
echo "AWS_PROFILE=nabu-${ENV} ssh -v ec2-user@$INSTANCE_ID"
echo
echo -e "${YELLOW}🗑️  To cleanup when done:${NC}"
echo "# Terminate the instance"
echo "aws ec2 terminate-instances --instance-ids $INSTANCE_ID"
echo
echo "# Remove the NFS rule from EFS security group"
echo "aws ec2 revoke-security-group-ingress --group-id $EFS_SECURITY_GROUP_ID --protocol tcp --port 2049 --source-group $EC2_SECURITY_GROUP_ID"
echo
echo "# Clean up IAM resources"
echo "aws iam detach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
echo "aws iam detach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
echo "aws iam detach-role-policy --role-name $ROLE_NAME --policy-arn $EFS_POLICY_ARN"
echo "aws iam delete-policy --policy-arn $EFS_POLICY_ARN"
echo "aws iam remove-role-from-instance-profile --instance-profile-name $INSTANCE_PROFILE_NAME --role-name $ROLE_NAME"
echo "aws iam delete-instance-profile --instance-profile-name $INSTANCE_PROFILE_NAME"
echo "aws iam delete-role --role-name $ROLE_NAME"
echo
echo "# Delete the EC2 security group (wait for instance to terminate first)"
echo "aws ec2 delete-security-group --group-id $EC2_SECURITY_GROUP_ID"
echo
echo -e "${GREEN}Happy coding! 🚀${NC}"
