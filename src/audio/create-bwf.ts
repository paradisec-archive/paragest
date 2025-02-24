import { writeFileSync } from 'node:fs';

import '../lib/sentry-node.js';
import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { StepError } from '../lib/errors.js';
import { download, upload } from '../lib/s3.js';
import { getItemBwfCsv } from '../models/item.js';

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

export const handler = async (event: Event) => {
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

  await download(
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
    '/tmp/input.wav',
  );

  execute('bwfmetaedit --in-core=core.csv input.wav', event);

  await upload(
    '/tmp/input.wav',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
    'audio/wav',
    true,
  );

  notes.push('createBWF: Created BWF file');

  return event;
};

processBatch<Event>(handler);
