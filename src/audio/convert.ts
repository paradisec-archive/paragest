import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { execute } from '../lib/command.js';
import { download, upload } from '../lib/s3.js';

type Event = {
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    filename: string;
    extension: string;
  };
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  await download(bucketName, objectKey, '/tmp/input');

  // Stereo, 96kHz, 24-bit
  execute('ffmpeg -y -i input -ac 2 -ar 96000 -c:a pcm_s24le -rf64 auto output.wav', event);

  await upload('/tmp/output.wav', bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`, 'audio/wav');

  notes.push('convert: Converted to WAV');

  return event;
});
