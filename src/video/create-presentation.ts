import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { getMediaMetadata } from '../lib/media.js';
import { getPath } from '../lib/s3.js';

type Event = {
  id: string;
  notes: string[];
  principalId: string;
  bucketName: string;
  objectKey: string;
  objectSize: number;
  details: {
    filename: string;
    extension: string;
  };
  taskToken: string;
};

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { filename, extension },
  } = event;

  const src = getPath('input');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), '.mp4')}`);

  const {
    other: { bitDepth, scanType, generalCodecId, audioCodecId, videoCodecId },
  } = await getMediaMetadata(src, event);

  const is10Bit = bitDepth === 10;
  const isInterlaced = scanType === 'Interlaced';
  const isAcceptablePresentationInput = generalCodecId === 'isom (isom/iso2/avc1/mp41)' && audioCodecId === 'AAC LC' && videoCodecId === 'AVC';

  notes.push(`create-presentation: Is 10-bit: ${is10Bit}`);
  notes.push(`create-presentation: Is interlaced: ${isInterlaced}`);
  notes.push(`create-presentation: Codecs (G/A/V): ${generalCodecId}/${audioCodecId}/${videoCodecId}`);
  notes.push(`create-presentation: Is acceptable presentation format: ${isAcceptablePresentationInput}`);

  if (isAcceptablePresentationInput) {
    execute(`mv '${src}' '${dst}'`, event);

    notes.push('create-presentation: Copied MP4 file');

    return event;
  }

  execute(
    `ffmpeg -y -hide_banner -i '${src}' -sn -c:v libx264 -pix_fmt yuv420p ${isInterlaced ? '-vf yadif' : ''} -preset slower -crf 15 -ac 2 -c:a aac '${dst}'`,
    event,
  );

  notes.push('create-presentation: Created MP4 file');

  return event;
};

processBatch<Event>(handler);
