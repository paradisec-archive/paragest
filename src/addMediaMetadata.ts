import { execSync } from 'node:child_process';

import * as Sentry from '@sentry/serverless';

import type { Handler } from 'aws-lambda';
import { fileTypeFromTokenizer } from 'file-type/core';

import { makeTokenizer } from '@tokenizer/s3';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { z } from 'zod';

import { StepError } from './lib/errors.js';
import './lib/sentry.js';

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

const GeneralTrack = z.object({
  '@type': z.literal('General'),
  VideoCount: z.coerce.number().optional(),
  AudioCount: z.coerce.number().optional(),
  FileExtension: z.string(),
  Format: z.string(),
  FileSize: z.coerce.number(),
  Duration: z.coerce.number(),
  OverallBitRate_Mode: z.string().optional(),
  OverallBitRate: z.coerce.number(),
  FrameRate: z.coerce.number().optional(),
  FrameCount: z.coerce.number().optional(),
  StreamSize: z.coerce.number(),
  IsStreamable: z.string().transform((value) => value === 'Yes').optional(),
});

const VideoTrack = z.object({
  '@type': z.literal('Video'),
  StreamOrder: z.coerce.number(),
  ID: z.coerce.number(),
  Format: z.string(),
  CodecID: z.string(),
  Duration: z.coerce.number(),
  BitRate_Mode: z.string().optional(),
  BitRate: z.coerce.number(),
  Width: z.coerce.number(),
  Height: z.coerce.number(),
  Sampled_Width: z.coerce.number(),
  Sampled_Height: z.coerce.number(),
  PixelAspectRatio: z.coerce.number(),
  DisplayAspectRatio: z.coerce.number(),
  Rotation: z.coerce.number(),
  FrameRate_Mode: z.string(),
  FrameRate: z.coerce.number(),
  FrameRate_Num: z.coerce.number(),
  FrameRate_Den: z.coerce.number(),
  FrameCount: z.coerce.number(),
  ColorSpace: z.string(),
  BitDepth: z.coerce.number(),
  ScanType: z.string(),
  Compression_Mode: z.string().optional(),
  StreamSize: z.coerce.number(),
});

const AudioTrack = z.object({
  '@type': z.literal('Audio'),
  StreamOrder: z.coerce.number().optional(),
  ID: z.coerce.number().optional(),
  Format: z.string(),
  Format_Settings_Endianness: z.string().optional(),
  Format_Settings_Sign: z.string().optional(),
  CodecID: z.string().optional(),
  Duration: z.coerce.number(),
  BitRate_Mode: z.string(),
  BitRate: z.coerce.number(),
  Channels: z.coerce.number(),
  ChannelPositions: z.string().optional(),
  ChannelLayout: z.string().optional(),
  SamplingRate: z.coerce.number(),
  SamplingCount: z.coerce.number(),
  BitDepth: z.coerce.number().optional(),
  StreamSize: z.coerce.number(),
});

const MediaTrack = z.discriminatedUnion('@type', [GeneralTrack, VideoTrack, AudioTrack]);

const MediaInfoSchema = z.object({
  creatingLibrary: z.object({
    name: z.literal('MediaInfoLib'),
    version: z.string(),
    url: z.string().url(),
  }),
  media: z.object({
    '@ref': z.string(),
    track: z.array(MediaTrack),
  }),
});

const s3 = new S3Client();

const getFiletype = async (bucketName: string, objectKey: string) => {
  const s3Tokenizer = await makeTokenizer(s3, {
    Bucket: bucketName,
    Key: objectKey,
  });

  const fileType = await fileTypeFromTokenizer(s3Tokenizer);

  return fileType;
};

const getMediaMetadata = async (bucketName: string, objectKey: string) => {
  const getObjectCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  });

  const signedUrl = await getSignedUrl(s3, getObjectCommand, { expiresIn: 300 });

  const command = `/opt/mediainfo --output=JSON '${signedUrl}'`;

  const output = execSync(command, { encoding: 'utf-8' });
  console.debug('MediaInfo output:', output);
  const metadata = MediaInfoSchema.parse(JSON.parse(output));
  console.debug('Metadata:', JSON.stringify(metadata, null, 2));

  const general = metadata.media.track.find((track) => track['@type'] === 'General');
  if (!general) {
    throw new Error('No general track found');
  }
  if (general['@type'] !== 'General') {
    throw new Error('Should never happen, just for TS');
  }

  const audio = metadata.media.track.find((track) => track['@type'] === 'Audio');
  if (audio && audio['@type'] !== 'Audio') {
    throw new Error('Should never happen, just for TS');
  }
  const video = metadata.media.track.find((track) => track['@type'] === 'Video');
  if (video && video['@type'] !== 'Video') {
    throw new Error('Should never happen, just for TS');
  }

  return {
    channels: audio?.Channels,
    duration: general.Duration,
    samplerate: audio?.SamplingRate,
    bitrate: general.OverallBitRate,
    fps: video?.FrameRate,
  };
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
      return 'audio/vnd.wave';

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

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
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

  if (mimetype.startsWith('audio') || mimetype.startsWith('video')) {
    const mediaAttributes = await getMediaMetadata(bucketName, objectKey);
    Object.assign(attributes, mediaAttributes);
  }

  console.debug('Attributes:', JSON.stringify(attributes, null, 2));

  if (essence) {
    const [updatedEssence, error] = await updateEssence(essence.id, attributes);
    if (!updatedEssence) {
      throw new StepError(`${filename}: Couldn't update essence`, event, { ...event, error, attributes });
    }
  } else {
    const [createdEssence, error] = await createEssence(collectionIdentifier, itemIdentifier, filename, attributes);
    if (!createdEssence) {
      throw new StepError(`${filename}: Couldn't create essence`, event, { ...event, error, attributes });
    }
  }
});
