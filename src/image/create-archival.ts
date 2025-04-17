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

  execute('convert input -compress lzw output.tif', event);

  await upload(
    'output.tif',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.tif')}`,
    'image/tiff',
  );

  notes.push('create-archival: created TIFF');

  return event;
};

processBatch<Event>(handler);
