import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';

import * as Sentry from '@sentry/aws-serverless';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { getMediaMetadata } from '../lib/media.js';

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
  videoBitDepth: number;
};

const s3 = new S3Client();

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  });
  const { Body } = await s3.send(getCommand);
  const writeStream = createWriteStream('/tmp/input');
  await new Promise((resolve, reject) => {
    (Body as Readable).pipe(writeStream).on('error', reject).on('finish', resolve);
  });

  // TODO maybe refactor later as this accesses via S3 and we've already downloaded
  const {
    other: { bitDepth, scanType, generalFormat, audioCodecId, videoCodecId },
  } = await getMediaMetadata(bucketName, objectKey);

  const is10Bit = bitDepth === 10;
  const isInterlaced = scanType === 'Interlaced';
  const isAcceptablePresentationInput =
    generalFormat === 'Matroska' && audioCodecId === 'A_FLAC' && videoCodecId === 'V_MS/VFW/FOURCC / FFV1';

  notes.push(`create-archival: Is 10-bit: ${is10Bit}`);
  notes.push(`create-archival: Is interlaced: ${isInterlaced}`);
  notes.push(`create-archival: Codecs (G/A/V): ${generalFormat}/${audioCodecId}/${videoCodecId}`);
  notes.push(`create-archival: Is acceptable presentation format: ${isAcceptablePresentationInput}`);

  execSync('df -h', { stdio: 'inherit', cwd: '/tmp' });
  execSync('ls -alh /tmp', { stdio: 'inherit', cwd: '/tmp' });
  if (isAcceptablePresentationInput) {
    execSync('mv input output.mkv', { stdio: 'inherit', cwd: '/tmp' });
    notes.push('create-archival: Copied MKV file');
  } else {
    try {
      execSync(
        'ffmpeg -y -hide_banner -i input -map 0 -dn -c:v ffv1 -level 3 -g 1 -slicecrc 1 -slices 16 -c:a flac output.mkv',
        { stdio: 'inherit', cwd: '/tmp' },
      );
    } catch (error) {
      execSync('ls -alh /tmp', { stdio: 'inherit', cwd: '/tmp' });
      execSync('df -h', { stdio: 'inherit', cwd: '/tmp' });
      console.error('Error: ', error);
      throw error;
    }
    notes.push('create-archival: Created MKV file');
  }

  const readStream = createReadStream('/tmp/output.mkv');

  await new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mkv')}`,
      Body: readStream,
      ContentType: 'application/mkv',
    },
  }).done();

  return event;
});
