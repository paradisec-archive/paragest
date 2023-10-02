import type { Handler } from 'aws-lambda';

import { StepError } from './lib/errors.js';

type Event = {
  principalId: string,
  objectKey: string,
  objectSize: number
};

const ALLOWED_ZERO_SIZE_EXTENSIONS = [
  'annis',
];

export const handler: Handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const { principalId, objectKey, objectSize } = event;

  if (objectSize > 0) {
    return;
  }

  const extension = objectKey.split('.').pop();
  if (!extension) {
    throw new StepError(`File ${objectKey} does not have an extension`, principalId, { objectKey });
  }

  if (ALLOWED_ZERO_SIZE_EXTENSIONS.includes(extension)) {
    return;
  }

  throw new StepError(`File ${objectKey} is empty and not in allowed extensions [${ALLOWED_ZERO_SIZE_EXTENSIONS.join(',')}]`, principalId, { objectKey });
};
