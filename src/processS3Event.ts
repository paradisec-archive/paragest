import type { S3Event, Handler } from 'aws-lambda';
import { SFN, type StartExecutionCommandInput } from '@aws-sdk/client-sfn';

const stateMachineArn = process.env.STATE_MACHINE_ARN;
if (!stateMachineArn) {
  throw new Error('STATE_MACHINE_ARN node defined');
}

const sfn = new SFN({});

export const handler: Handler = async (event: S3Event) => {
  console.debug('S3 event:', JSON.stringify(event, null, 2));

  const promises = event.Records.map((record) => {
    const bucketName = record.s3.bucket.name;
    const objectKey = record.s3.object.key;
    const { principalId } = record.userIdentity;

    const input = JSON.stringify({ bucketName, objectKey, principalId });

    const params: StartExecutionCommandInput = { stateMachineArn, input };
    const promise = sfn.startExecution(params);

    return promise;
  });

  await Promise.all(promises);
};
