#!/usr/bin/bash

KEY=$1
if [ -z "$KEY" ]; then
  echo "Usage: $0 <key>"
  exit 1
fi

SIZE=$(aws s3api head-object \
  --bucket paragest-ingest-stage \
  --key incoming/${KEY} \
  | jq -r .ContentLength
)

if [ -z "$SIZE" ]; then
  echo "Key not found"
  exit 1
fi

FUNC_NAME=$(aws lambda list-functions | jq -r '.Functions[] | select(.FunctionName | startswith("ParagestStack-ProcessS3EventLambda")) | .FunctionName')

EVENT=$(cat <<EOF
{
  "Records": [{
    "userIdentity": {
      "principalId": "AWS:AJJJ:jfer7719_admin"
    },
    "s3": {
      "bucket": {
        "name": "paragest-ingest-stage"
      },
      "object": {
        "key": "incoming/${KEY}",
        "size": $SIZE
      }
    }
  }]
}
EOF
)

aws lambda invoke \
  --function-name $FUNC_NAME \
  --payload "${EVENT}" \
  --cli-binary-format raw-in-base64-out \
  /dev/null
