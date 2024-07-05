import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
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

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  await download(bucketName, objectKey, '/tmp/input');

  execute('convert input -quality 85 output.jpg', event);

  await upload('/tmp/output.jpg', bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.jpg')}`, 'image/jpeg');

  notes.push('createPresentation: Created MP4 file');

  return event;
});
