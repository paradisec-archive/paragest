import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

import { StepError } from './lib/errors.js';

type Event = {
  objectKey: string;
  objectSize: number;
  notes: string[];
};

const ALLOWED_ZERO_SIZE_EXTENSIONS = ['annis'];

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const { objectKey, objectSize, notes } = event;

  if (objectSize > 0) {
    notes.push(`rejectEmptyFiles: File ${objectKey} is not empty`);

    return event;
  }

  const extension = objectKey.split('.').pop();
  if (!extension) {
    throw new StepError(`File ${objectKey} does not have an extension`, event, { objectKey });
  }

  if (ALLOWED_ZERO_SIZE_EXTENSIONS.includes(extension)) {
    notes.push(`rejectEmptyFiles: File ${objectKey} is has an allowed empty file extension`);

    return event;
  }

  throw new StepError(`File ${objectKey} is empty and not in allowed extensions [${ALLOWED_ZERO_SIZE_EXTENSIONS.join(',')}]`, event, { objectKey });
});
