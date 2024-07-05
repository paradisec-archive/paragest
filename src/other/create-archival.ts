import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { copy } from '../lib/s3.js';

type Event = {
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    filename: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename },
    bucketName,
    objectKey,
  } = event;

  await copy(bucketName, objectKey, bucketName, `output/${filename}/${filename}`);

  notes.push('create-archival: uploaded file');

  return event;
});
