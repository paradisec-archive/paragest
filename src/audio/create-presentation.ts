import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import type { Readable } from 'node:stream';

import * as Sentry from '@sentry/serverless';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import type { Handler } from 'aws-lambda';

import { StepError } from '../lib/errors.js';
import '../lib/sentry.js';
import { getItemId3 } from '../models/item.js';

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

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { collectionIdentifier, itemIdentifier, filename, extension },
    bucketName,
    objectKey,
  } = event;

  const txt = await getItemId3(collectionIdentifier, itemIdentifier);
  if (!txt) {
    throw new StepError(`Couldn't get ID3 TXT for ${filename}`, event, { objectKey });
  }
  writeFileSync('/tmp/id3.txt', txt);

  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
  });
  const { Body } = await s3.send(getCommand);
  const writeStream = createWriteStream('/tmp/input.wav');
  await new Promise((resolve, reject) => {
    (Body as Readable).pipe(writeStream).on('error', reject).on('finish', resolve);
  });
  // NOTE: we convert to MP3 and also set max volume to 0dB
  // We assume we are already at -6dB from previous step in pipeline
  // Due to lossy nature we don't get exactly 0dB
  execSync(
    'ffmpeg -y -i input.wav -i id3.txt -map_metadata 1 -write_id3v2 1 -filter:a "volume=6dB" -codec:a libmp3lame -ar 44100 -b:a 128k output.mp3',
    { stdio: 'inherit', cwd: '/tmp' },
  );

  const readStream = createReadStream('/tmp/output.mp3');

  await new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mp3')}`,
      Body: readStream,
      ContentType: 'audio/mpeg',
    },
  }).done();

  notes.push('createPresentation: Created MP3 file');

  return event;
});
