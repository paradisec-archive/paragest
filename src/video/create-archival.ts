import fs from 'node:fs';

import '../lib/sentry-node.js';

import { getMediaMetadata } from '../lib/media.js';
import { execute } from '../lib/command.js';
import { download, upload } from '../lib/s3.js';
import { processBatch } from '../lib/batch.js';

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
  videoBitDepth: number;
  taskToken: string;
};

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));
  const {
    notes,
    details: { filename, extension },
    bucketName,
    objectKey,
  } = event;

  fs.mkdirSync(`/mnt/efs/${process.env.AWS_BATCH_JOB_ID}`);

  await download(bucketName, objectKey, 'input');

  // TODO maybe refactor later as this accesses via S3 and we've already downloaded
  const {
    other: { bitDepth, scanType, generalFormat, audioCodecId, videoCodecId },
  } = await getMediaMetadata(bucketName, objectKey, event);

  const is10Bit = bitDepth === 10;
  const isInterlaced = scanType === 'Interlaced';
  const isAcceptablePresentationInput =
    generalFormat === 'Matroska' && audioCodecId === 'A_FLAC' && videoCodecId === 'V_MS/VFW/FOURCC / FFV1';

  notes.push(`create-archival: Is 10-bit: ${is10Bit}`);
  notes.push(`create-archival: Is interlaced: ${isInterlaced}`);
  notes.push(`create-archival: Codecs (G/A/V): ${generalFormat}/${audioCodecId}/${videoCodecId}`);
  notes.push(`create-archival: Is acceptable presentation format: ${isAcceptablePresentationInput}`);

  if (isAcceptablePresentationInput) {
    execute('mv input output.mkv', event);
    notes.push('create-archival: Copied MKV file');
  } else {
    execute(
      'ffmpeg -y -hide_banner -i input -sn -map 0 -dn -c:v ffv1 -level 3 -g 1 -slicecrc 1 -slices 16 -c:a flac output.mkv',
      event,
    );
    notes.push('create-archival: Created MKV file');
  }

  await upload(
    'output.mkv',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mkv')}`,
    'application/mkv',
    true,
  );

  return event;
};

processBatch<Event>(handler);
