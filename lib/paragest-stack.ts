import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import { genLambdaProps } from './constructs/step';
import { StateMachine } from './constructs/state-machine';

// TODO: Be more specific on where functions can read and write

export class ParagestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.env?.account === '618916419351' ? 'prod' : 'stage';

    // /////////////////////////////
    // Database
    // /////////////////////////////

    const concurrencyTable = new dynamodb.TableV2(this, 'ConcurrencyTable', {
      tableName: 'ConcurrencyTable',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    });

    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
      lifecycleRules: [{ prefix: 'rejected/', expiration: cdk.Duration.days(4 * 7) }],
    });

    const catalogBucket = s3.Bucket.fromBucketName(this, 'CatalogBucket', `nabu-catalog-${env}`);

    const nabuOauthSecret = new secretsmanager.Secret(this, 'NabuOAuthSecret', {
      description: 'OAuth credentials for Nabu',
      secretName: '/paragest/nabu/oauth',
      secretObjectValue: {
        clientId: cdk.SecretValue.unsafePlainText('FIXME'),
        clientSecret: cdk.SecretValue.unsafePlainText('FIXME'),
      },
    });

    // /////////////////////////////
    // Network
    // /////////////////////////////

    // NOTE: Service Policy prevents us from creating a VPC from CF (it shoudn't but it does)
    // so we generate it in the console and import it here
    const vpc = ec2.Vpc.fromLookup(this, 'FargateVPC', {
      vpcId: ssm.StringParameter.valueFromLookup(this, '/paragest/resources/vpc-id'),
    });
    const subnets = ['a', 'b', 'c'].map((az, index) => {
      const subnetId = ssm.StringParameter.valueForStringParameter(
        this,
        `/paragest/resources/subnets/private/apse2${az}-id`,
      );
      const availabilityZone = `ap-southeast-2${az}`;
      const subnet = ec2.Subnet.fromSubnetAttributes(this, `DataSubnet${index}`, { subnetId, availabilityZone });
      cdk.Annotations.of(subnet).acknowledgeWarning('@aws-cdk/aws-ec2:noSubnetRouteTableId');

      return subnet;
    });

    const nabuServiceName = ssm.StringParameter.valueFromLookup(this, '/nabu/resources/nlb-endpoint/service-name');
    const nabuVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'NabuNLBInterfaceEndpoint', {
      service: new ec2.InterfaceVpcEndpointService(nabuServiceName, 443),
      vpc,
      subnets: {
        subnets,
      },
      open: true,
    });
    const nabuDnsName = cdk.Fn.select(1, cdk.Fn.split(':', cdk.Fn.select(0, nabuVpcEndpoint.vpcEndpointDnsEntries)));

    // For our code
    new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      vpc,
      subnets: {
        subnets,
      },
    });

    // For our code
    const dynamodbVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'DynamoDbEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.DYNAMODB,
      vpc,
      subnets: {
        subnets,
      },
      privateDnsEnabled: false,
    });
    const dynamodbDnsName = cdk.Fn.select(
      1,
      cdk.Fn.split(':', cdk.Fn.select(0, dynamodbVpcEndpoint.vpcEndpointDnsEntries)),
    );

    // Our code at end of batch
    new ec2.InterfaceVpcEndpoint(this, 'StepFunctionsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
      vpc,
      subnets: {
        subnets,
      },
    });

    // Needed by fargate
    new ec2.InterfaceVpcEndpoint(this, 'ECREndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      vpc,
      subnets: {
        subnets,
      },
    });

    // Needed by fargate
    new ec2.InterfaceVpcEndpoint(this, 'ECRDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      vpc,
      subnets: {
        subnets,
      },
    });

    // Needed by fargate
    new ec2.InterfaceVpcEndpoint(this, 'LogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      vpc,
      subnets: {
        subnets,
      },
    });

    // /////////////////////////////
    // Filesystem
    // /////////////////////////////

    const fileSystem = new efs.FileSystem(this, 'FargateFileSystem', {
      vpc,
      vpcSubnets: {
        subnets,
      },
    });

    const accessPoint = fileSystem.addAccessPoint('ServiceAccessPoint', {
      path: '/paragest',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });

    // /////////////////////////////
    // Batch
    // /////////////////////////////
    const volume = batch.EcsVolume.efs({
      name: 'efs',
      fileSystem,
      accessPointId: accessPoint.accessPointId,
      containerPath: '/mnt/efs',
      enableTransitEncryption: true,
      useJobRole: true,
    });

    const batchEnv = new batch.FargateComputeEnvironment(this, 'FargateBatch', {
      vpc,
      vpcSubnets: {
        subnets,
      },
      updateToLatestImageVersion: true,
      // spot: true,
      // NOTE: Leaving this at default of 256 means because we allocate 8 vCPUs per task, we can only run 32 tasks at a time
      // NOTE: This helps us not run out of IPs
      // maxvCpus: 256
    });
    fileSystem.connections.allowDefaultPortFrom(batchEnv.securityGroups[0]);

    const jobQueue = new batch.JobQueue(this, 'BatchQueue', {
      priority: 1,
      jobStateTimeLimitActions: [
        {
          action: batch.JobStateTimeLimitActionsAction.CANCEL,
          maxTime: cdk.Duration.minutes(30),
          reason: batch.JobStateTimeLimitActionsReason.INSUFFICIENT_INSTANCE_CAPACITY,
          state: batch.JobStateTimeLimitActionsState.RUNNABLE,
        },
      ],
    });
    jobQueue.addComputeEnvironment(batchEnv, 1);

    // /////////////////////////////
    // State Machine
    // /////////////////////////////
    const shared = {
      env,
      volume,
      accessPoint,
      jobQueue,
      concurrencyTable,
      vpc,
      subnets,
      nabuDnsName,
      dynamodbDnsName,
    };

    const stateMachine = new StateMachine(this, 'ParagestStateMachine', {
      ...shared,
      catalogBucket,
      ingestBucket,
      nabuOauthSecret,
    });

    // /////////////////////////////
    // S3 Ingest
    // /////////////////////////////
    const processS3Event = new nodejs.NodejsFunction(
      this,
      'ProcessS3EventLambda',
      genLambdaProps({
        shared,
        src: 'process-s3-event.ts',
        lambdaProps: { environment: { STATE_MACHINE_ARN: stateMachine.stateMachine.stateMachineArn } },
      }),
    );

    stateMachine.stateMachine.grantStartExecution(processS3Event);
    ingestBucket.grantRead(processS3Event);

    const s3IncomingEventSource = new eventsources.S3EventSource(ingestBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'incoming/' }],
    });
    processS3Event.addEventSource(s3IncomingEventSource);

    const s3DamsmartEventSource = new eventsources.S3EventSource(ingestBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'damsmart/' }],
    });
    processS3Event.addEventSource(s3DamsmartEventSource);
  }
}
