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
    other: { bitDepth, scanType, generalCodecId, audioCodecId, videoCodecId },
  } = await getMediaMetadata(bucketName, objectKey);

  const is10Bit = bitDepth === 10;
  const isInterlaced = scanType === 'Interlaced';
  const isAcceptablePresentationInput = generalCodecId.startsWith('isom') && audioCodecId === 'AAC LC' && videoCodecId === 'AVC';

  notes.push(`create-presentation: Is 10-bit: ${is10Bit}`);
  notes.push(`create-presentation: Is interlaced: ${isInterlaced}`);
  notes.push(`create-presentation: Codecs (G/A/V): ${generalCodecId}/${audioCodecId}/${videoCodecId}`);
  notes.push(`create-presentation: Is acceptable presentation format: ${isAcceptablePresentationInput}`);

  if (isAcceptablePresentationInput) {
    execSync('mv input output.mp4', { stdio: 'inherit', cwd: '/tmp' });
    notes.push('create-presentation: Copied MP4 file');
  } else {
    execSync(
      `ffmpeg -y -hide_banner -i input -c:v libx264 -pix_fmt yuv420p ${isInterlaced ? '-vf yadif' : ''} -preset slower -crf 15 -c:a aac output.mp4`,
      { stdio: 'inherit', cwd: '/tmp' },
    );
    notes.push('create-presentation: Created MP4 file');
  }

  const readStream = createReadStream('/tmp/output.mp4');

  await new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mp4')}`,
      Body: readStream,
      ContentType: 'video/mp4',
    },
  }).done();


  return event;
});
