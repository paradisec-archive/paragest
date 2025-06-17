import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import '../lib/sentry.js';

import { StepError } from '../lib/errors.js';
import { getCollection } from '../models/collection.js';

type Event = {
  bucketName: string;
  objectKey: string;
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
  const { objectKey } = event;

  console.log('🪚 ⭐ MOO');
  const md = objectKey.match(/^(?:incoming|damsmart)\/([A-Za-z0-9][a-zA-Z0-9_]+)-deposit\.pdf$/);
  if (!md) {
    return {
      ...event,
      isSpecialFile: false,
    };
  }

  console.log('🪚 🔵');
  const [, collectionIdentifier] = md;
  if (!collectionIdentifier) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, event, { objectKey });
  }

  console.log('🪚 💜');
  const filename = `${collectionIdentifier}-deposit.pdf`;
  const collection = await getCollection(collectionIdentifier);
  console.log('🪚 🟩');

  if (!collection) {
    throw new StepError(
      `File ${filename} for collection: ${collectionIdentifier} but it is not in the database`,
      event,
      { objectKey },
    );
  }
  console.log('🪚 🔲');

  const details = {
    collectionIdentifier,
    filename,
    extension: 'pdf',
  };

  return {
    ...event,
    details,
    isSpecialFile: true,
  };
});
