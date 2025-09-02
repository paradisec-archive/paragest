import { writeFileSync } from 'node:fs';

import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { StepError } from '../lib/errors.js';
import { getPath } from '../lib/s3.js';
import { getItemId3 } from '../models/item.js';

type Event = {
  id: string;
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

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { collectionIdentifier, itemIdentifier, filename, extension },
    objectKey,
  } = event;

  const txt = await getItemId3(collectionIdentifier, itemIdentifier);
  if (!txt) {
    throw new StepError(`Couldn't get ID3 TXT for ${filename}`, event, { objectKey });
  }
  writeFileSync('/tmp/id3.txt', txt);

  const src = getPath('volume-maxed.wav');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), '.mp3')}`);

  // NOTE: we convert to MP3 and also set max volume to 0dB
  // We assume we are already at -6dB from previous step in pipeline
  // Due to lossy nature we don't get exactly 0dB
  const cmd = `ffmpeg -y -i '${src}' -i /tmp/id3.txt -map_metadata 1 -write_id3v2 1 -filter:a "volume=6dB" -codec:a libmp3lame -ar 44100 -b:a 128k '${dst}'`;
  notes.push(`createPresentation: Executing command: ${cmd}`);
  execute(cmd, event);

  notes.push('createPresentation: Created MP3 file');

  return event;
};

processBatch<Event>(handler);
