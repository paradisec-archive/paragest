import { execSync } from 'node:child_process';

import * as Sentry from '@sentry/serverless';

import type { Handler } from 'aws-lambda';

import { StepError } from './lib/errors.js';
import './lib/sentry.js';

import { getEssence, createEssence, updateEssence } from './models/essence.js';

type Event = {
  principalId: string;
  bucketName: string;
  objectKey: string;
  objectSize: number;
  details: {
    itemIdentifier: string;
    collectionIdentifier: string;
    filename: string;
    extension: string;
  };
};

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    details: { collectionIdentifier, itemIdentifier, filename, extension },
    bucketName,
    objectKey,
    objectSize,
  } = event;
});
