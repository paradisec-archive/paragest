import { writeFileSync } from 'node:fs';

import '../lib/sentry-node.js';
import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { StepError } from '../lib/errors.js';
import { getPath } from '../lib/s3.js';
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
    objectKey,
  } = event;

  const src = getPath('volume-maxed.wav');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`);

  const csv = await getItemBwfCsv(collectionIdentifier, itemIdentifier, 'volume-maxed.wav');
  if (!csv) {
    throw new StepError(`Couldn't get BWF CSV for ${filename}`, event, { objectKey });
  }
  writeFileSync('/tmp/core.csv', csv);

  execute(`bwfmetaedit --in-core=/tmp/core.csv '${src}'`, event);
  execute(`cp '${src}' '${dst}'`, event);

  notes.push('createBWF: Created BWF file');

  return event;
};

processBatch<Event>(handler);
