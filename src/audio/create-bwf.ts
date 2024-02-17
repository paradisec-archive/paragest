import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import * as Sentry from '@sentry/serverless';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import type { Handler } from 'aws-lambda';

import { StepError } from '../lib/errors.js';
import '../lib/sentry.js';
import { getItemBwfCsv } from '../models/item.js';

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

  const csv = await getItemBwfCsv(collectionIdentifier, itemIdentifier, 'input.wav');
  if (!csv) {
    throw new StepError(`Couldn't get BWF CSV for ${filename}`, event, { objectKey });
  }
  writeFileSync('/tmp/core.csv', csv);

  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
  });
  const { Body } = await s3.send(getCommand);
  const writeStream = createWriteStream('/tmp/input.wav');
  await new Promise((resolve, reject) => {
    (Body as Readable).pipe(writeStream).on('error', reject).on('finish', resolve);
  });

  execSync('bwfmetaedit --in-core=core.csv input.wav', { stdio: 'inherit', cwd: '/tmp' });

  const readStream = createReadStream('/tmp/input.wav');

  await new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
      Body: readStream,
      ContentType: 'audio/wav',
    },
  }).done();

  notes.push('createBWF: Created BWF file');

  return event;
});
