import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';

import { StepError } from '../lib/errors.js';
import { getCollection } from '../models/collection.js';

type Event = {
  bucketName: string;
  objectKey: string;
  notes: string[];
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
  const { objectKey, notes } = event;

  const md = objectKey.match(/^(?:incoming|damsmart)\/([A-Za-z0-9][a-zA-Z0-9_]+)-deposit\.pdf$/);
  if (!md) {
    notes.push('isSpecial: false');

    return {
      ...event,
      isSpecialFile: false,
    };
  }

  const [, collectionIdentifier] = md;
  if (!collectionIdentifier) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, event, { objectKey });
  }

  const filename = `${collectionIdentifier}-deposit.pdf`;
  const collection = await getCollection(collectionIdentifier);

  if (!collection) {
    throw new StepError(`File ${filename} for collection: ${collectionIdentifier} but it is not in the database`, event, { objectKey });
  }

  const details = {
    collectionIdentifier,
    filename,
    extension: 'pdf',
  };

  notes.push('isSpecial: true');

  return {
    ...event,
    details,
    isSpecialFile: true,
  };
});
