import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';

import * as Sentry from '@sentry/serverless';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';

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

  execSync('ffmpeg -y -hide_banner -i input -c:v libx264 output.mp4', { stdio: 'inherit', cwd: '/tmp' });

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

  notes.push('createPresentation: Created MP4 file');

  return event;
});
