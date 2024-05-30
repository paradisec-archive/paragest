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

// n_samples: 320994
// mean_volume: -13.8 dB
// max_volume: -1.8 dB
// histogram_1db: 2
// histogram_2db: 409
// Convert a string with the above into an object
const checkSilence = (stats: string, event: Event) => {
  const lines = stats.split('\n');
  const statsObject: Record<string, number> = {};

  lines.forEach((line) => {
    const [key, value] = line.replace(' dB', '').split(': ');
    if (!key || !value) {
      return;
    }

    statsObject[key] = Number(value);
  });

  if (!('max_volume' in statsObject && 'mean_volume' in statsObject)) {
    throw new StepError("Couldn't get silence stats", event, { statsObject, rawStats: lines });
  }

  if (statsObject.max_volume < -50 && statsObject.mean_volume < -50) {
    return true;
  }

  return false;
};

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
  const left = execSync(
    'ffmpeg -y -i left.wav -filter:a volumedetect -f null /dev/null 2>&1 | grep volumedetect | sed "s/^.*] //"',
    { cwd: '/tmp' },
  );
  console.debug('Left:', left.toString());
  const leftSilent = checkSilence(left.toString(), event);
  const right = execSync(
    'ffmpeg -y -i right.wav -filter:a volumedetect -f null /dev/null 2>&1 | grep volumedetect | sed "s/^.*] //"',
    { cwd: '/tmp' },
  );
  console.debug('Right:', right.toString());
  const rightSilent = checkSilence(right.toString(), event);

  if (leftSilent && rightSilent) {
    throw new StepError('Both channels are silent', event, {});
  }

  if (!leftSilent && !rightSilent) {
    notes.push('fixSilence: Neither channel is silent');
    console.debug('Both channels have audio, not doing anything');
    return event;
  }

  const file = leftSilent ? 'right' : 'left';
  console.debug(`Only ${file} channel has audio, copying to output.wav`);
  notes.push(`Only ${file} channel has audio, copying to silent channel`);

  execSync(`ffmpeg -y -i ${file}.wav -ac 2 -ar 96000 -c:a pcm_s24le output.wav`, { stdio: 'inherit', cwd: '/tmp' });

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
