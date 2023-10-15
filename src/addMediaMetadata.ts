import type { Handler } from 'aws-lambda';
import { fileTypeFromTokenizer } from 'file-type/core';
import { makeTokenizer } from '@tokenizer/s3';
import { S3Client } from '@aws-sdk/client-s3';

import { StepError } from './lib/errors.js';

import { getEssence, createEssence, updateEssence } from './models/essence.js';

type Event = {
  principalId: string,
  bucketName: string,
  objectKey: string,
  objectSize: number
  details: {
    itemIdentifier: string,
    collectionIdentifier: string,
    filename: string,
    extension: string,
  },
};

const s3 = new S3Client();

const getFiletype = async (bucketName: string, objectKey: string) => {
  const s3Tokenizer = await makeTokenizer(s3, {
    Bucket: bucketName,
    Key: objectKey,
  });

  const fileType = await fileTypeFromTokenizer(s3Tokenizer);

  return fileType;
};

const lookupMimetypeFromExtension = (extension: string) => {
  switch (extension) {
    case 'annis':
    case 'cha':
    case 'TextGrid':
    case 'lbl':
    case 'tab':
    case 'txt':
    case 'version':
    case 'srt':
      return 'text/plain';

    case 'eaf':
    case 'flextext':
    case 'kml':
    case 'idmi':
    case 'ixt':
    case 'trs':
    case 'xml':
      return 'text/xml';

    case 'html':
      return 'text/html';
    case 'xhtml':
      return 'application/xhtml+xml';

    case 'csv':
      return 'text/csv';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ods':
      return 'application/vnd.oasis.opendocument.spreadsheet';

    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'odt':
      return 'application/vnd.oasis.opendocument.text';
    case 'rtf':
      return 'text/rtf';
    case 'tex':
      return 'text/x-tex';

    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'webp':
      return 'image/webp';

    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/x-wav';

    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mpeg':
    case 'mpg':
      return 'video/mpeg';
    case 'dv':
      return 'video/x-dv';
    case 'mkv':
      return 'video/x-matroska';
    case 'mxf':
      return 'application/mxf';
    case 'mts':
      return 'video/mpt2';
    case 'avi':
      return 'video/x-msvideo';

    case 'pdf':
      return 'application/pdf';

    case 'iso':
      return 'application/x-iso9660-image';
    case 'zip':
      return 'application/zip';

    default:
      return null;
  }
};

export const handler: Handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    details: {
      collectionIdentifier,
      itemIdentifier,
      filename,
      extension,
    },
    bucketName,
    objectKey,
    objectSize,
  } = event;

  const filetype = await getFiletype(bucketName, objectKey);
  console.debug(filetype);
  if (!filetype) {
    throw new StepError(`${filename}: Couldn't determine filetype`, event, event);
  }

  if (filetype.ext !== extension) {
    throw new StepError(`${filename}: File extension doesn't match detected filetype ${filetype.ext}`, event, event);
  }

  const mimetype = lookupMimetypeFromExtension(extension);
  if (!mimetype) {
    throw new StepError(`${filename}: Couldn't determine mimetype`, event, { ...event, filetype });
  }

  if (filetype.mime !== mimetype) {
    throw new StepError(`${filename}: File mimetype doesn't match detected filetype ${mimetype} vs ${filetype.mime}`, event, { ...event, filetype });
  }

  const essence = await getEssence(collectionIdentifier, itemIdentifier, filename);

  const attributes = {
    mimetype,
    size: objectSize,
  };

  if (essence) {
    const [updatedEssence, error] = await updateEssence(essence.id, attributes);
    if (!updatedEssence) {
      throw new StepError(`${filename}: Couldn't update essence`, event, { ...event, error });
    }
  } else {
    const [createdEssence, error] = await createEssence(collectionIdentifier, itemIdentifier, filename, attributes);
    if (!createdEssence) {
      throw new StepError(`${filename}: Couldn't create essence`, event, { ...event, error });
    }
  }
};
