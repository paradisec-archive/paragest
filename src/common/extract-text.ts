import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { EXTRACTED_TEXT_FILENAME } from '../lib/media.js';
import { getPath } from '../lib/s3.js';
import { extractText } from '../lib/text-extraction.js';

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

  const inputPath = getPath('input');
  const outputPath = getPath(EXTRACTED_TEXT_FILENAME);

  notes.push(`extract-text: Extracting text from ${filename}`);

  const text = await extractText(inputPath, extension);
  fs.writeFileSync(outputPath, text, 'utf-8');

  notes.push(`extract-text: Extracted ${text.length} characters`);

  return event;
});
