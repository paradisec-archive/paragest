import * as Sentry from '@sentry/serverless';

import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';

type Event = {
  notes: string[];
  principalId: string;
  bucketName: string;
  objectKey: string;
  objectSize: number;
  details: {
    itemIdentifier: string;
    collectionIdentifier: string;
    filename: string;
    extension: string;
  };
  videoBitDepth: number;
};

const s3 = new S3Client();

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename },
    bucketName,
    objectKey,
  } = event;

  const copyCommand = new CopyObjectCommand({
    CopySource: `${bucketName}/${objectKey}`,
    Bucket: bucketName,
    Key: `output/${filename}/${filename}`,
  });
  await s3.send(copyCommand);

  notes.push('create-archival: uploaded file');

  return event;
});
