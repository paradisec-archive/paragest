import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { getPath } from '../lib/s3.js';

type Event = {
  id: string;
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    filename: string;
    extension: string;
  };
};

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const { notes } = event;

  const src = getPath('input');
  const dst = getPath('converted.wav');

  // Stereo, 96kHz, 24-bit
  const cmd = `ffmpeg -y -i '${src}' -ac 2 -ar 96000 -c:a pcm_s24le -rf64 auto '${dst}'`;
  notes.push(`convert: Executing command: ${cmd}`);
  execute(cmd, event);

  notes.push('convert: Converted to WAV');

  return event;
};

processBatch<Event>(handler);
