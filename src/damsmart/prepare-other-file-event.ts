import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { StepError } from '../lib/errors.js';

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
    objectSize,
    details: { filename, extension },
  } = event;

  let otherExtension: string;
  switch (extension) {
    case 'mp3':
      otherExtension = 'wav';
      break;
    case 'wav':
      otherExtension = 'mp3';
      break;
    case 'mp4':
      otherExtension = 'mkv';
      break;
    case 'mkv':
      otherExtension = 'mp4';
      break;
    default:
      throw new StepError(`Unsupported file extension: ${extension}`, event, { extension });
  }

  const otherFilename = filename.replace(new RegExp(`\\.${extension}$`), `.${otherExtension}`);
  if (otherFilename === filename) {
    throw new StepError(`Filename ${filename} does not match expected pattern for extension ${extension}`, event, {
      filename,
      extension,
    });
  }

  const otherObjectKey = event.objectKey.replace(new RegExp(`\\.${extension}$`), `.${otherExtension}`);

  notes.push(`prepare-other-file-event: Prepared event for other file ${otherFilename}`);

  return {
    ...event,
    objectKey: otherObjectKey,
    objectSize, // We'll use the same size for now, actual size will be determined during processing
    details: {
      ...event.details,
      filename: otherFilename,
      extension: otherExtension,
    },
  };
});
