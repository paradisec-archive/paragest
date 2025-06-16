import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

type Event = {
  bucketName: string;
  objectKey: string;
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
  const { objectKey } = event;

  return {
    ...event,
    isDASmart: objectKey.startsWith('damsmart/'),
  };
});
