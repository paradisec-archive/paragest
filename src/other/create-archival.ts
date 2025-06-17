import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { execute } from '../lib/command.js';
import { getPath } from '../lib/s3.js';

type Event = {
  notes: string[];
  details: {
    filename: string;
    extension: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
  } = event;

  const lowerExtension = extension.toLowerCase();

  const src = getPath('input');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), `.${lowerExtension}`)}`);

  execute(`mv '${src}' '${dst}'`, event);

  notes.push('create-archival: uploaded file');

  return event;
});
