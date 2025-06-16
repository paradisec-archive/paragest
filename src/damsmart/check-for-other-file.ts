import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { head } from '../lib/s3.js';
import { StepError } from '../lib/errors.js';

type Event = {
  notes: string[];
  bucketName: string;
  objectKey: string;
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
    bucketName,
    objectKey,
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
      throw new StepError(`Unsupported file extension: ${extension}`, event, { objectKey });
  }

  const otherFilename = filename.replace(new RegExp(`.${extension}$`), `/.${otherExtension}$/`);
  if (otherFilename === filename) {
    throw new StepError(
      `Filename ${filename} does not match expected pattern for extension ${extension} ${otherExtension}`,
      event,
      { objectKey },
    );
  }

  const exists = await head(bucketName, otherFilename);

  if (!exists) {
    notes.push("damsmart-other-check: The other file doesn't exist yet");

    return {
      ...event,
      isDAMSmartOtherPresent: false,
    };
  }

  notes.push('damsmart-other-check: Other file is present');

  return {
    ...event,
    isDAMSmartOtherPresent: true,
  };
});
