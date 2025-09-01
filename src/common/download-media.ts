import fs from 'node:fs';

import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { download, getPath } from '../lib/s3.js';

type Event = {
  id: string;
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

const handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const { notes, bucketName, objectKey } = event;

  const dir = getPath('output');

  fs.mkdirSync(dir, { recursive: true });

  await download(bucketName, objectKey, 'input');

  notes.push(`downloadMedia: downloaded ${objectKey} from bucket ${bucketName}`);

  return event;
};

processBatch<Event>(handler);
