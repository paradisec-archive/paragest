import '../lib/sentry-node.js';

import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';

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
  taskToken: string;
};

const s3 = new S3Client();
const sfn = new SFNClient();

export const handler = (async (event: Event) => {
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
  const isAcceptablePresentationInput = generalCodecId === 'isom (isom/iso2/avc1/mp41)' && audioCodecId === 'AAC LC' && videoCodecId === 'AVC';

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
      ChecksumAlgorithm: 'SHA256',
    },
    partSize: 100 * 1024 * 1024,
  }).done();

  const successCommand = new SendTaskSuccessCommand({
    taskToken: process.env.SFN_TASK_TOKEN,
    output: JSON.stringify(event),
  });
  await sfn.send(successCommand);
});


const event = process.env.SFN_INPUT;
if (!event) {
  throw new Error('No event provided');
}

handler(JSON.parse(event));
