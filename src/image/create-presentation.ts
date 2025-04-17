import { rmSync } from 'node:fs';

import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
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

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  await download(bucketName, objectKey, 'input');

  execute('convert input -quality 85 output.jpg', event);

  await upload(
    'output.jpg',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.jpg')}`,
    'image/jpeg',
  );

  rmSync(`/mnt/efs/${process.env.SFN_ID}`, { recursive: true, force: true });

  notes.push('createPresentation: Created MP4 file');

  return event;
};

processBatch<Event>(handler);
