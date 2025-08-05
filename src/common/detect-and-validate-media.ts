import { FileMagic } from '@npcz/magic';
import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';
import mime from 'mime-types';

import '../lib/sentry.js';
import { StepError } from '../lib/errors.js';
import { lookupMimetypeFromExtension } from '../lib/media.js';
import { getPath } from '../lib/s3.js';

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

FileMagic.magicFile = require.resolve('@npcz/magic/dist/magic.mgc');

const getMagic = async () => {
  const magic = await FileMagic.getInstance();

  const path = getPath('input');
  const magicMimetype = magic.detectMimeType(path).toLowerCase();

  let mimetype: string = magicMimetype;
  switch (mimetype) {
    case 'audio/x-m4a':
      mimetype = 'audio/mp4';
      break;
    case 'audio/x-m4v':
      mimetype = 'video/mp4';
      break;
    case 'audio/x-wav':
      mimetype = 'audio/wav';
      break;
    case 'video/vnd.avi':
      mimetype = 'video/x-msvideo';
      break;
    default:
  }

  return mimetype;
};

const mimetypeMatchesExtension = (mimetype: string, actualExt: string) => {
  console.log('🪚 🟩 MME');
  console.log('🪚 mimetype:', JSON.stringify(mimetype, null, 2));
  console.log('🪚 actualExt:', JSON.stringify(actualExt, null, 2));
  const possibleExt = mime.extensions[mimetype.toLocaleLowerCase()] || [];
  console.log('🪚 possibleExt:', JSON.stringify(possibleExt, null, 2));

  if (possibleExt.includes(actualExt)) {
    console.log('🪚 🔲');
    return true;
  }

  console.log('🪚 💜');
  switch (true) {
    case ['text/xml', 'application/xml'].includes(mimetype) && ['eaf', 'imdi', 'cmdi', 'opex'].includes(actualExt):
      return true;
    // case detected === 'mpg' && actual === 'vob':
    //   return true;
    // case detected === 'mp4' && actual === 'm4a':
    //   return true;
    default:
      console.log('🪚 🔵');
      return false;
  }
};

const allowedMimetypeException = (detected: string, actual: string) => {
  switch (true) {
    case ['text/xml', 'application/xml'].includes(detected) && !!actual.match('application/(eaf|imdi|cmdi|opex)\\+xml'):
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

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { filename, extension },
  } = event;

  const detectedMimetype = await getMagic();
  if (!detectedMimetype) {
    throw new StepError(`${filename}: Couldn't determine mimetype`, event, event);
  }

  if (!mimetypeMatchesExtension(detectedMimetype, extension)) {
    throw new StepError(`${filename}: extension doesn't match detected mimetype ${detectedMimetype} ${extension}`, event, event);
  }

  const mimetype = lookupMimetypeFromExtension(extension);
  if (!mimetype) {
    throw new StepError(`${filename}: Unsupported file extension ${extension}`, event, { detected: detectedMimetype });
  }

  if (detectedMimetype !== mimetype && !allowedMimetypeException(detectedMimetype, mimetype)) {
    throw new StepError(`${filename}: File mimetype doesn't match detected filetype ${detectedMimetype} != ${mimetype}`, event, {
      detected: detectedMimetype,
      extension,
      mimetype,
    });
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
