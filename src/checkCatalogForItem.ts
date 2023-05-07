import type { S3Event, Handler } from 'aws-lambda';

export const handler: Handler = async (event: S3Event) => {
  console.debug('S3 Data:', JSON.stringify(event, null, 2));
};
