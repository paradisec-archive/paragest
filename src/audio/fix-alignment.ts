import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';

import * as Sentry from '@sentry/aws-serverless';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { StepError } from '../lib/errors.js';

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
  } = event;

  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
  });
  const { Body } = await s3.send(getCommand);
  const writeStream = createWriteStream('/tmp/input.wav');
  await new Promise((resolve, reject) => {
    (Body as Readable).pipe(writeStream).on('error', reject).on('finish', resolve);
  });

  execSync('ffmpeg -y -i input.wav -map_channel 0.0.0 left.wav', { stdio: 'inherit', cwd: '/tmp' });
  execSync('ffmpeg -y -i input.wav -map_channel 0.0.1 right.wav', { stdio: 'inherit', cwd: '/tmp' });

  const resultJSON = execSync('audio-offset-finder --find-offset-of left.wav --within right.wav --json', {
    cwd: '/tmp',
  });
  const result = JSON.parse(resultJSON.toString()) as { time_offset: number; standard_score: number };

  if (!('time_offset' in result && 'standard_score' in result)) {
    throw new StepError('Audio offset finder failed', event, { result });
  }

  const { time_offset: offset, standard_score: score } = result;

  if (score < 10) {
    notes.push(`fixAlignment: low deviation, not fixing ${resultJSON.toString()}`);
    console.debug(`fixAlignment: low deviation, not fixing ${resultJSON.toString()}`);

    return event;
  }

  if (offset > 0.05) {
    notes.push(`fixAlignment: offset ${offset} is too big, ignoring (score ${score})`);
    console.debug(`fixAlignment: offset ${offset} is too big, ignoring (score ${score})`);

    return event;
  }

  if (offset === 0) {
    notes.push(`fixAlignment: no offset, ignoring (score ${score})`);
    console.debug(`fixAlignment: no offset, ignoring (score ${score})`);

    return event;
  }

  notes.push(`fixAlignment: alignement is off by ${offset} seconds with a score of ${score}`);
  console.debug(`fixAlignment: low deviation, not fixing ${result}`);

  const misalignmentMs = offset * 1000;
  const delay = misalignmentMs > 0 ? `${misalignmentMs.toFixed(0)}|0` : `0|${(misalignmentMs * -1).toFixed(0)}`;
  execSync(`ffmpeg -i input.wav -af "adelay=${delay}" -ac 2 -ar 96000 -c:a pcm_s24le output.wav`, { stdio: 'inherit', cwd: '/tmp' });

  const readStream = createReadStream('/tmp/output.wav');

  await new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
      Body: readStream,
      ContentType: 'audio/wav',
    },
  }).done();

  return event;
});
