import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { download, getPath } from '../lib/s3.js';

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
  console.debug('Event:', JSON.stringify(event, null, 2));

  const { notes, bucketName, objectKey } = event;

  const dir = getPath('');

  fs.mkdirSync(dir);

  await download(bucketName, objectKey, 'input');

  notes.push(`downloadMedia: downloaded ${objectKey} from bucket ${bucketName}`);

  return event;
});
