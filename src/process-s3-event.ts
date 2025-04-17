import { GetObjectTaggingCommand, S3 } from '@aws-sdk/client-s3';
import { SFN, type StartExecutionCommandInput } from '@aws-sdk/client-sfn';
import type { Handler, S3Event } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

const stateMachineArn = process.env.STATE_MACHINE_ARN;
if (!stateMachineArn) {
  throw new Error('STATE_MACHINE_ARN node defined');
}

const sfn = new SFN({});
const s3 = new S3({});

const hasManualTag = async (bucketName: string, objectKey: string): Promise<boolean> => {
  const taggingResponse = await s3.send(
    new GetObjectTaggingCommand({
      Bucket: bucketName,
      Key: objectKey,
    }),
  );

  if (!taggingResponse.TagSet || taggingResponse.TagSet.length === 0) {
    return false;
  }

  return taggingResponse.TagSet.some((tag) => tag.Key === 'manual' && tag.Value === 'true');
};

export const handler: Handler = Sentry.wrapHandler(async (event: S3Event) => {
  console.debug('S3 event:', JSON.stringify(event, null, 2));

  const promises = await Promise.all(
    event.Records.map(async (record) => {
      const bucketName = record.s3.bucket.name;
      const objectKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      const objectSize = record.s3.object.size;
      const { principalId } = record.userIdentity;

      if (objectKey.match(/\/\.keep$/)) {
        return false;
      }

      // Check if this file has the manual tag
      const isManual = await hasManualTag(bucketName, objectKey);

      if (isManual) {
        console.log(`Skipping ${objectKey} because it has the manual=true tag`);
        return false;
      }

      const input = JSON.stringify({
        id: uuidv4(),
        bucketName,
        objectKey,
        objectSize,
        principalId,
        notes: [`processS3Event: ${objectKey} added to ${bucketName} by ${principalId} with size ${objectSize}`],
      });

      const params: StartExecutionCommandInput = { stateMachineArn, input };
      return sfn.startExecution(params);
    }),
  );

  // Filter out false values (skipped files)
  await Promise.all(promises.filter(Boolean));
});
