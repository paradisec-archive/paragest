import { writeFileSync } from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { StepError } from '../lib/errors.js';
import { execute } from '../lib/command.js';
import { getItemBwfCsv } from '../models/item.js';
import { download, upload } from '../lib/s3.js';

type Event = {
  notes: string[];
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

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { collectionIdentifier, itemIdentifier, filename, extension },
    bucketName,
    objectKey,
  } = event;

  const csv = await getItemBwfCsv(collectionIdentifier, itemIdentifier, 'input.wav');
  if (!csv) {
    throw new StepError(`Couldn't get BWF CSV for ${filename}`, event, { objectKey });
  }
  writeFileSync('/tmp/core.csv', csv);

  await download(bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`, '/tmp/input.wav');

  execute('bwfmetaedit --in-core=core.csv input.wav', event);

  upload('/tmp/input.wav', bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`, 'audio/wav');

  notes.push('createBWF: Created BWF file');

  return event;
});
