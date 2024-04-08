import * as Sentry from '@sentry/serverless';

import type { Handler } from 'aws-lambda';
import { fileTypeFromTokenizer } from 'file-type/core';
import { makeTokenizer } from '@tokenizer/s3';
import { S3Client } from '@aws-sdk/client-s3';

import './lib/sentry.js';
import { StepError } from './lib/errors.js';
import { lookupMimetypeFromExtension } from './lib/media.js';

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

const s3 = new S3Client();

const getFiletype = async (bucketName: string, objectKey: string) => {
  const s3Tokenizer = await makeTokenizer(s3, {
    Bucket: bucketName,
    Key: objectKey,
  });

  const fileType = await fileTypeFromTokenizer(s3Tokenizer);
  if (!fileType) {
    return undefined;
  }

  return {
    mimetype: fileType.mime === 'audio/wav' ? 'audio/vnd.wave' : fileType.mime,
    ext: fileType.ext,
  };
};

const allowedException = (detected: string, actual: string) => {
  switch (true) {
    case detected === 'mp4' && actual === '3gp':
      return true;
    default:
      return false;
  }
};

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  const detected = await getFiletype(bucketName, objectKey);
  if (!detected) {
    throw new StepError(`${filename}: Couldn't determine filetype`, event, event);
  }

  if (detected.ext !== extension && !allowedException(detected.ext, extension)) {
    throw new StepError(`${filename}: File extension doesn't match detected filetype ${detected.ext}`, event, event);
  }

  const mimetype = lookupMimetypeFromExtension(extension);
  if (!mimetype) {
    throw new StepError(`${filename}: Unsupported file extension`, event, { detected });
  }

  if (detected.mimetype !== mimetype) {
    if (detected.mimetype === 'audio/x-m4a' && mimetype === 'audio/mp4') {
      // This is an allowed exception
    } else {
      throw new StepError(
        `${filename}: File mimetype doesn't match detected filetype ${mimetype} vs ${detected.mimetype}`,
        event,
        { detected },
      );
    }
  }

  notes.push(`detectAndValidateMedia: Detected mimetype as ${mimetype}`);

  let mediaType: string;
  switch (true) {
    case mimetype.startsWith('audio'):
      mediaType = 'audio';
      break;
    case mimetype.startsWith('video'):
      mediaType = 'video';
      break;
    case mimetype.startsWith('image'):
      mediaType = 'image';
      break;
    default:
      mediaType = 'other';
  }
  notes.push(`detectAndValidateMedia: Identified media type as ${mediaType}`);

  return {
    ...event,
    mediaType,
  };
});
