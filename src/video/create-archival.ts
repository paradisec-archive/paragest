import '../lib/sentry-node.js';

import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';

import { getMediaMetadata } from '../lib/media.js';
import { execute } from '../lib/command.js';
import { download, upload } from '../lib/s3.js';
import { StepError } from '../lib/errors.js';

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

const sfn = new SFNClient();

export const handler = async (event: Event) => {
  throw new StepError('TEST ERROR', event, { });
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
      event
    );
    notes.push('create-archival: Created MKV file');
  }

  await upload('/tmp/output.mkv', bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mkv')}`, 'application/mkv', true);

  const successCommand = new SendTaskSuccessCommand({
    taskToken: process.env.SFN_TASK_TOKEN,
    output: JSON.stringify(event),
  });
  await sfn.send(successCommand);
};

const event = process.env.SFN_INPUT;
if (!event) {
  throw new Error('No event provided');
}

handler(JSON.parse(event));
