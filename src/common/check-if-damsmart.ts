import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import '../lib/sentry.js';

type Event = {
  bucketName: string;
  objectKey: string;
  notes: string[];
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const { objectKey, notes } = event;

  const isDamsmart = objectKey.startsWith('damsmart/');

  notes.push(`isDamSmart: ${isDamsmart}`);

  return {
    ...event,
    isDamsmart,
  };
});
