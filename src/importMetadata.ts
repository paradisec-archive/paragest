import type { Handler } from 'aws-lambda';

// import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

type Event = {
  principalId: string,
  bucketName: string,
  objectKey: string,
  objectSize: number
};

// const s3 = new S3Client();

//  if (!process.env.PARAGEST_ENV) {
//   throw new Error('PARAGEST_ENV not set');
// }
// const env = process.env.PARAGEST_ENV;

// const destBucket = `nabu-catalog-${env}2`;

export const handler: Handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
};
