import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

import { StepError } from './lib/errors.js';
import { getItem } from './models/item.js';

type Event = {
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    itemIdentifier: string;
    collectionIdentifier: string;
    filename: string;
    extension: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('S3 Data:', JSON.stringify(event, null, 2));

  const {
    objectKey,
    details: { collectionIdentifier, itemIdentifier, filename },
  } = event;

  const item = await getItem(collectionIdentifier, itemIdentifier);

  if (!item) {
    throw new StepError(`File ${filename} is for collection: ${collectionIdentifier} item: ${itemIdentifier} but that is not in the database`, event, { objectKey });
  }

  if (!item.metadata_exportable) {
    throw new StepError(`The metadata for essence ${filename}  of item ${collectionIdentifier}-${itemIdentifier} has not been marked as exportable`, event, { objectKey });
  }

  event.notes.push('checkIfPDSC: Item is exportable');

  return event;
});
