import type { Handler } from 'aws-lambda';

import { StepError } from './lib/errors.js';

type Event = {
  principalId: string,
  objectKey: string,
  details: {
    itemIdentifier: string,
  },
};

export const handler: Handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const { details: { itemIdentifier }, objectKey } = event;

  if (itemIdentifier.length > 30) {
    throw new StepError(`File ${objectKey}: Item id longer than 30 chars (OLAC incompatible)`, event, { objectKey, itemIdentifier });
  }
};
