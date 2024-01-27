import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';

import * as Sentry from '@sentry/serverless';
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

// max_volume: -1.8 dB
const getVolume = (stats: string, event: Event) => {
  const lines = stats.split('\n');
  const statsObject: Record<string, number> = {};

  lines.forEach((line) => {
    const [key, value] = line.replace(' dB', '').split(': ');
    if (!key || !value) {
      return;
    }

    statsObject[key] = Number(value);
  });

  if (!statsObject.max_volume) {
    throw new StepError("Couldn't get colume stat", event, { statsObject, rawStats: lines });
  }

  return statsObject.max_volume;
};

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
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

  const analysis = execSync(
    'ffmpeg -i input.wav -filter:a volumedetect -f null /dev/null 2>&1 | grep volumedetect | sed "s/^.*] //"',
    { cwd: '/tmp' },
  );
  console.debug('Analysis:', analysis.toString());
  const maxVolume = getVolume(analysis.toString(), event);

  notes.push(`fixVolume: Volume is at ${maxVolume} dB`);
  const diff = (-6 - maxVolume).toFixed(1);
  if (diff === '0.0') {
    return event;
  }

  notes.push(`fixVolume: Adjusting by ${diff} dB`);
  execSync(`ffmpeg -i input.wav -af "volume=${diff}dB" output.wav`, { stdio: 'inherit', cwd: '/tmp' });

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
