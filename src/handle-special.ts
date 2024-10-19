import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import './lib/sentry.js';
import { move } from './lib/s3.js';
import { setHasDepositForm } from './models/collection.js';
import { StepError } from './lib/errors.js';

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV not set');
}
const env = process.env.PARAGEST_ENV;

const destBucket = `nabu-catalog-${env}`;

type Event = {
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    filename: string;
    extension: string;
    collectionIdentifier: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    bucketName,
    objectKey,
    details: { collectionIdentifier },
  } = event;

  const dest = `${collectionIdentifier}/pdsc_admin/${collectionIdentifier}-deposit.pdf`;
  await move(bucketName, objectKey, destBucket, dest);

  const error = await setHasDepositForm(collectionIdentifier);
  if (error) {
    throw new StepError(`${event.details.filename}: Couldn't update db with despoit form presence`, event, { error });
  }

  notes.push(`handleSpecial: Copying ${objectKey} to catalog`);

  return event;
});
