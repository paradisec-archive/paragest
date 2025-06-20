import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
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

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const { notes, bucketName, objectKey } = event;

  const dir = getPath('output');

  fs.mkdirSync(dir, { recursive: true });

  await download(bucketName, objectKey, 'input');

  notes.push(`downloadMedia: downloaded ${objectKey} from bucket ${bucketName}`);

  return event;
});
