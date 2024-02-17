import * as Sentry from '@sentry/serverless';

import type { Handler } from 'aws-lambda';

import './lib/sentry.js';

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
});
