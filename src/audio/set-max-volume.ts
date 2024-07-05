import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { StepError } from '../lib/errors.js';
import { execute } from '../lib/command.js';
import { download, upload } from '../lib/s3.js';

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

  if (!('max_volume' in statsObject)) {
    throw new StepError("Couldn't get volume stat", event, { statsObject, rawStats: lines });
  }

  return statsObject.max_volume;
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
  } = event;

  await download(bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`, '/tmp/input.wav');

  const analysis = execute(
    'ffmpeg -i input.wav -filter:a volumedetect -f null /dev/null 2>&1 | grep volumedetect | sed "s/^.*] //"',
    event
  );
  const maxVolume = getVolume(analysis.toString(), event);

  notes.push(`setMaxVolume: Volume is at ${maxVolume} dB`);
  const diff = (-6 - maxVolume).toFixed(1);
  if (diff === '0.0') {
    return event;
  }

  notes.push(`setMaxVolume: Adjusting by ${diff} dB`);
  execute(`ffmpeg -y -i input.wav -af "volume=${diff}dB" -ac 2 -ar 96000 -c:a pcm_s24le -rf64 auto output.wav`, event);

  await upload('/tmp/output.wav', bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`, 'audio/wav');

  return event;
});
