import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { execute } from '../lib/command.js';
import { getPath } from '../lib/s3.js';

type Event = {
  id: string;
  notes: string[];
  details: {
    filename: string;
    extension: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { filename, extension },
  } = event;

  const lowerExtension = extension === 'TextGrid' ? extension : extension.toLowerCase();

  const src = getPath('input');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), `.${lowerExtension}`)}`);

  execute(`cp '${src}' '${dst}'`, event);

  notes.push('create-archival: uploaded file');

  return event;
});
