import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';
import { FileMagic } from '@npcz/magic';
import mime from 'mime-types';

import '../lib/sentry.js';
import { StepError } from '../lib/errors.js';
import { lookupMimetypeFromExtension } from '../lib/media.js';
import { getPath } from '../lib/s3.js';

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

FileMagic.magicFile = require.resolve('@npcz/magic/dist/magic.mgc');

const getMagic = async () => {
  const magic = await FileMagic.getInstance();

  const path = getPath('input');
  const magicMimetype = magic.detectMimeType(path);

  let mimetype: string = magicMimetype;
  switch (mimetype) {
    case 'audio/x-m4a':
      mimetype = 'audio/mp4';
      break;
    case 'audio/wav':
    case 'audio/x-wav':
      mimetype = 'audio/vnd.wav';
      break;
    case 'video/vnd.avi':
      mimetype = 'video/x-msvideo';
      break;
    default:
  }

  return mimetype;
};

const mimetypeMatchesExtension = (mimetype: string, actualExt: string) => {
  const possibleExt = mime.extensions[mimetype] || [];

  if (possibleExt.includes(actualExt)) {
    return true;
  }

  switch (true) {
    case mimetype === 'application/xml' && ['eaf', 'imdi', 'cmdi', 'opex'].includes(actualExt):
      return true;
    // case detected === 'mpg' && actual === 'vob':
    //   return true;
    // case detected === 'mp4' && actual === 'm4a':
    //   return true;
    default:
      return false;
  }
};

const allowedMimetypeException = (detected: string, actual: string) => {
  switch (true) {
    case detected === 'application/xml' && !!actual.match('application/(eaf|imdi|cmdi|opex)+xml'):
      return true;
    // case detected === 'video/mp4' && actual === 'audio/mp4':
    //   return true;
    // case detected === 'video/MP2P' && actual === 'video/x-ms-vob':
    //   return true;
    // case detected === 'application/rtf' && actual === 'text/rtf':
    //   return true;
    default:
      return false;
  }
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    notes,
    details: { filename, extension },
  } = event;

  const detectedMimetype = await getMagic();
  if (!detectedMimetype) {
    throw new StepError(`${filename}: Couldn't determine mimetype`, event, event);
  }

  if (!mimetypeMatchesExtension(detectedMimetype, extension)) {
    throw new StepError(
      `${filename}: extension doesn't match detected mimetype ${detectedMimetype} ${extension}`,
      event,
      event,
    );
  }

  const mimetype = lookupMimetypeFromExtension(extension);
  if (!mimetype) {
    throw new StepError(`${filename}: Unsupported file extension ${extension}`, event, { detected: detectedMimetype });
  }

  if (detectedMimetype !== mimetype && !allowedMimetypeException(detectedMimetype, mimetype)) {
    throw new StepError(
      `${filename}: File mimetype doesn't match detected filetype ${detectedMimetype} != ${mimetype}`,
      event,
      { detected: detectedMimetype, extension, mimetype },
    );
  }

  notes.push(`detectAndValidateMedia: Detected mimetype as ${mimetype}`);

  let mediaType: string;
  switch (true) {
    case mimetype.startsWith('audio'):
      mediaType = 'audio';
      break;
    case mimetype.startsWith('video'):
    case mimetype === 'application/mxf':
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
