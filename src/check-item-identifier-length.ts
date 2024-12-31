import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

import { StepError } from './lib/errors.js';

type Event = {
  principalId: string;
  objectKey: string;
  details: {
    itemIdentifier: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    details: { itemIdentifier },
    objectKey,
  } = event;

  if (itemIdentifier.length > 30) {
    throw new StepError(`File ${objectKey}: Item id longer than 30 chars (OLAC incompatible)`, event, {
      objectKey,
      itemIdentifier,
    });
  }

  return event;
});
