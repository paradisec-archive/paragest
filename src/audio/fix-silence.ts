import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { StepError } from '../lib/errors.js';
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

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
  } = event;

  await download(
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
    'input.wav',
  );

  const left = execute(
    'ffmpeg -y -i input.wav -filter_complex "[0:a]pan=mono|c0=c0,volumedetect" -f null /dev/null 2>&1 | grep volumedetect_ | sed "s/^.*] //"',
    event,
  );
  const leftSilent = checkSilence(left.toString(), event);

  const right = execute(
    'ffmpeg -y -i input.wav -filter_complex "[0:a]pan=mono|c0=c1,volumedetect" -f null /dev/null 2>&1 | grep volumedetect_ | sed "s/^.*] //"',
    event,
  );
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

  const filter = leftSilent ? 'c0=c1|c1=c1' : 'c0=c0|c1=c0';
  execute(
    `ffmpeg -y -i input.wav -filter_complex "pan=stereo|${filter}" -ac 2 -ar 96000 -c:a pcm_s24le -rf64 auto output.wav`,
    event,
  );

  await upload(
    'output.wav',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
    'audio/wav',
  );

  return event;
};

processBatch<Event>(handler);
