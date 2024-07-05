import { createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';

import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';
import { FileMagic } from '@npcz/magic';
import { fileTypeFromTokenizer } from 'file-type/core';
import { makeTokenizer } from '@tokenizer/s3';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

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

FileMagic.magicFile = require.resolve('@npcz/magic/dist/magic.mgc');

const getFiletype = async (bucketName: string, objectKey: string) => {
  const s3Tokenizer = await makeTokenizer(s3, {
    Bucket: bucketName,
    Key: objectKey,
  });

  const fileType = await fileTypeFromTokenizer(s3Tokenizer);
  if (!fileType) {
    return undefined;
  }

  let mimetype: string = fileType.mime;
  switch (mimetype) {
    case 'audio/x-m4a':
      mimetype = 'audio/mp4';
      break;
    case 'audio/wav':
      mimetype = 'audio/vnd.wav';
      break;
    case 'video/vnd.avi':
      mimetype = 'video/x-msvideo';
      break;
    default:
  }

  return {
    mimetype,
    ext: fileType.ext,
  };
};

const getMagic = async (bucketName: string, objectKey: string) => {
  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Range: 'bytes=0-20479',
  });
  const { Body } = await s3.send(getCommand);
  const writeStream = createWriteStream('/tmp/input');
  await new Promise((resolve, reject) => {
    (Body as Readable).pipe(writeStream).on('error', reject).on('finish', resolve);
  });

  const magic = await FileMagic.getInstance();
  const mimetype = magic.detectMimeType('/tmp/input');

  const ext = objectKey.split('.').pop();
  if (!ext) {
    throw new Error('Why no extension');
  }

  return {
    mimetype,
    ext,
  };
};

const allowedExtensionException = (detected: string, actual: string) => {
  switch (true) {
    case detected === 'xml' && actual === 'eaf':
      return true;
    case detected === 'mpg' && actual === 'vob':
      return true;
    default:
      return false;
  }
};

const allowedMimetypeException = (detected: string, actual: string) => {
  switch (true) {
    case detected === 'application/xml' && actual === 'application/eaf+xml':
      return true;
    default:
      return false;
  }
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  const detected = (await getFiletype(bucketName, objectKey)) || (await getMagic(bucketName, objectKey));
  if (!detected) {
    throw new StepError(`${filename}: Couldn't determine filetype`, event, event);
  }

  if (detected.ext !== extension && !allowedExtensionException(detected.ext, extension)) {
    throw new StepError(`${filename}: File extension doesn't match detected filetype ${detected.ext} != ${extension}`, event, event);
  }

  const mimetype = lookupMimetypeFromExtension(extension);
  if (!mimetype) {
    throw new StepError(`${filename}: Unsupported file extension ${extension}`, event, { detected });
  }

  if (detected.mimetype !== mimetype && !allowedMimetypeException(detected.mimetype, mimetype)) {
    throw new StepError(
      `${filename}: File mimetype doesn't match detected filetype ${detected.mimetype} != ${mimetype}`,
      event,
      { detected, extension, mimetype },
    );
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
