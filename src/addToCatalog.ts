import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/serverless';

import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

import './lib/sentry.js';

type Event = {
  bucketName: string,
  objectKey: string,
  details: {
    collectionIdentifier: string,
    itemIdentifier: string,
    filename: string,
  },
};

const s3 = new S3Client();

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV not set');
}
const env = process.env.PARAGEST_ENV;

const destBucket = `nabu-catalog-${env}`;

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
  const {
    bucketName,
    objectKey,
    details: {
      collectionIdentifier,
      itemIdentifier,
      filename,
    },
  } = event;

  const copyCommand = new CopyObjectCommand({
    Bucket: destBucket,
    CopySource: `${bucketName}/${objectKey}`,
    Key: `${collectionIdentifier}/${itemIdentifier}/${filename}`,
    ChecksumAlgorithm: 'SHA256',
  });
  await s3.send(copyCommand);

  const deleteCommand = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  });
  await s3.send(deleteCommand);
});
