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

  await download(bucketName, objectKey, '/tmp/input');

  // TODO maybe refactor later as this accesses via S3 and we've already downloaded
  const {
    other: { bitDepth, scanType, generalCodecId, audioCodecId, videoCodecId },
  } = await getMediaMetadata(bucketName, objectKey, event);

  const is10Bit = bitDepth === 10;
  const isInterlaced = scanType === 'Interlaced';
  const isAcceptablePresentationInput =
    generalCodecId === 'isom (isom/iso2/avc1/mp41)' && audioCodecId === 'AAC LC' && videoCodecId === 'AVC';

  notes.push(`create-presentation: Is 10-bit: ${is10Bit}`);
  notes.push(`create-presentation: Is interlaced: ${isInterlaced}`);
  notes.push(`create-presentation: Codecs (G/A/V): ${generalCodecId}/${audioCodecId}/${videoCodecId}`);
  notes.push(`create-presentation: Is acceptable presentation format: ${isAcceptablePresentationInput}`);

  if (isAcceptablePresentationInput) {
    execute('mv input output.mp4', event);
    notes.push('create-presentation: Copied MP4 file');
  } else {
    execute(
      `ffmpeg -y -hide_banner -i input -sn -c:v libx264 -pix_fmt yuv420p ${isInterlaced ? '-vf yadif' : ''} -preset slower -crf 15 -ac 2 -c:a aac output.mp4`,
      event,
    );
    notes.push('create-presentation: Created MP4 file');
  }

  await upload(
    '/tmp/output.mp4',
    bucketName,
    `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mp4')}`,
    'video/mp4',
  );

  return event;
};

processBatch<Event>(handler);
