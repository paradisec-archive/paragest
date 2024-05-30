import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

import { StepError } from './lib/errors.js';
import { getItem } from './models/item.js';

type Event = {
  bucketName: string;
  objectKey: string;
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('S3 Data:', JSON.stringify(event, null, 2));

  const { objectKey } = event;

  const md = objectKey.match(/^incoming\/([A-Za-z][a-zA-Z0-9_]+)-([A-Za-z0-9][a-zA-Z0-9_]+)-(.*)\.([^.]+)$/);
  if (!md) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, event, { objectKey });
  }

  const [, collectionIdentifier, itemIdentifier, rest, extensionOrig] = md;
  if (!collectionIdentifier || !itemIdentifier || !rest || !extensionOrig) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, event, { objectKey });
  }
  const extension = extensionOrig?.toLowerCase();

  const filename = `${collectionIdentifier}-${itemIdentifier}-${rest}.${extension}`;
  console.debug('Filename:', filename);

  const item = await getItem(collectionIdentifier, itemIdentifier);

  if (!item) {
    throw new StepError(`File ${filename} is for collection: ${collectionIdentifier} item: ${itemIdentifier} but that is not in the database`, event, { objectKey });
  }

  const details = {
    collectionIdentifier,
    itemIdentifier,
    filename,
    extension,
  };

  return { ...event, details };
});
