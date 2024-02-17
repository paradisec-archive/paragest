import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/serverless';

import './lib/sentry.js';

type Event = {
  details: {
    filename: string;
  };
};

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
  const {
    details: { filename },
  } = event;

  const match = filename.match(/(.*)-PDSC_ADMIN\./);

  return {
    ...event,
    isPDSCFile: !!match,
  };
});
