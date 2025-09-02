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

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { filename, extension },
  } = event;

  const src = getPath('input');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), '.mkv')}`);

  const {
    other: { bitDepth, scanType, generalFormat, audioCodecId, videoCodecId, videoFrameRateMode },
  } = await getMediaMetadata(src, event);

  const is10Bit = bitDepth === 10;
  const isInterlaced = scanType === 'Interlaced';
  const isAcceptablePresentationInput = generalFormat === 'Matroska' && audioCodecId === 'A_FLAC' && videoCodecId === 'V_MS/VFW/FOURCC / FFV1';

  notes.push(`create-archival: Is 10-bit: ${is10Bit}`);
  notes.push(`create-archival: Is interlaced: ${isInterlaced}`);
  notes.push(`create-archival: Codecs (G/A/V): ${generalFormat}/${audioCodecId}/${videoCodecId}`);
  notes.push(`create-archival: Is acceptable presentation format: ${isAcceptablePresentationInput}`);
  notes.push(`create-presentation: Video Framerate Mode: ${videoFrameRateMode}`);

  if (isAcceptablePresentationInput) {
    execute(`mv '${src}' '${dst}'`, event);

    notes.push('create-archival: Copied MKV file');

    return event;
  }

  execute(
    `ffmpeg -y -hide_banner -i '${src}' -sn -map 0 -dn -c:v ffv1 -level 3 -g 1 -slicecrc 1 -slices 16 -vsync 0 -fps_mode passthrough -c:a flac '${dst}'`,
    event,
  );
  notes.push('create-archival: Created MKV file');

  return event;
};

processBatch<Event>(handler);
