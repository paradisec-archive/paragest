import { writeFileSync, rmSync } from 'node:fs';

import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { StepError } from '../lib/errors.js';
import { download, upload } from '../lib/s3.js';
import { getItemId3 } from '../models/item.js';

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

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { collectionIdentifier, itemIdentifier, filename, extension },
    bucketName,
    objectKey,
  } = event;

  const txt = await getItemId3(collectionIdentifier, itemIdentifier);
  if (!txt) {
    throw new StepError(`Couldn't get ID3 TXT for ${filename}`, event, { objectKey });
  }
  writeFileSync('/tmp/id3.txt', txt);

  await download(
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.wav')}`,
    'input.wav',
  );

  // NOTE: we convert to MP3 and also set max volume to 0dB
  // We assume we are already at -6dB from previous step in pipeline
  // Due to lossy nature we don't get exactly 0dB
  execute(
    'ffmpeg -y -i input.wav -i /tmp/id3.txt -map_metadata 1 -write_id3v2 1 -filter:a "volume=6dB" -codec:a libmp3lame -ar 44100 -b:a 128k output.mp3',
    event,
  );

  await upload(
    'output.mp3',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mp3')}`,
    'audio/mpeg',
  );

  rmSync(`/mnt/efs/${process.env.SFN_ID}`, { recursive: true, force: true });

  notes.push('createPresentation: Created MP3 file');

  return event;
};

processBatch<Event>(handler);
