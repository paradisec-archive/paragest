import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { EXTRACTED_CONTENT_FILENAME } from '../lib/media.js';
import { getPath } from '../lib/s3.js';
import { contentCharacterCount, extractContent } from '../lib/text-extraction.js';

type Event = {
  id: string;
  notes: string[];
  details: {
    collectionIdentifier: string;
    itemIdentifier: string;
    filename: string;
    extension: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { collectionIdentifier, itemIdentifier, filename, extension },
  } = event;

  Sentry.setTag('collection', collectionIdentifier);
  Sentry.setTag('item', itemIdentifier);
  Sentry.setTag('filename', filename);

  const inputPath = getPath('input');
  const outputPath = getPath(EXTRACTED_CONTENT_FILENAME);

  notes.push(`extract-text: Extracting text from ${filename}`);

  const content = await extractContent(inputPath, extension);
  if (!content) {
    notes.push('extract-text: No text extracted');
    return event;
  }

  fs.writeFileSync(outputPath, JSON.stringify(content), 'utf-8');

  notes.push(`extract-text: Extracted ${contentCharacterCount(content)} characters`);

  return event;
});
