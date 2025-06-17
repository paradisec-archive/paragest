import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
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

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  await download(bucketName, objectKey, 'input');

  const src = getPath('input');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), '.jpg')}`);

  execute(`convert '${src}' -quality 85 '${dst}'`, event);

  notes.push('create-presentation: Created JPG');

  return event;
};

processBatch<Event>(handler);
