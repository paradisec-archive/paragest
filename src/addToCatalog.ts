import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/serverless';

import { S3Client, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import './lib/sentry.js';

type Event = {
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    collectionIdentifier: string;
    itemIdentifier: string;
    filename: string;
  };
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
    notes,
    bucketName,
    details: { collectionIdentifier, itemIdentifier, filename },
  } = event;

  const prefix = `output/${filename}`;
  const listCommand = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const response = await s3.send(listCommand);
  console.debug(response);

  // copy each file
  const promises = response.Contents?.map(async (object) => {
    if (!object.Key) {
      throw new Error(`No object key ${JSON.stringify(object)}`);
    }

    const source = object.Key;
    const dest = `${collectionIdentifier}/${itemIdentifier}${object.Key.replace(prefix, '')}`;

    console.debug(`Copying ${source} to ${dest}`);
    notes.push(`addToCatalog: Copying ${source} to catalog`);
    const copyCommand = new CopyObjectCommand({
      CopySource: `${bucketName}/${source}`,
      Bucket: destBucket,
      Key: dest,
      ChecksumAlgorithm: 'SHA256',
    });

    await s3.send(copyCommand);

    console.debug(`Deleting output ${source}`);
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: source,
    });
    await s3.send(deleteCommand);
  });

  await Promise.all(promises || []);

  return event;
});
