import '../lib/sentry-node.js';

import { SFNClient, SendTaskFailureCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';

import { getMediaMetadata } from '../lib/media.js';
import { execute } from '../lib/command.js';
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
  taskToken: string;
};

const sfn = new SFNClient();

export const handler = (async (event: Event) => {
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
  const isAcceptablePresentationInput = generalCodecId === 'isom (isom/iso2/avc1/mp41)' && audioCodecId === 'AAC LC' && videoCodecId === 'AVC';

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
      event
    );
    notes.push('create-presentation: Created MP4 file');
  }

  await upload('/tmp/output.mp4', bucketName, `output/${filename}/${filename.replace(new RegExp(`.${extension}$`), '.mp4')}`, 'video/mp4');

  const successCommand = new SendTaskSuccessCommand({
    taskToken: process.env.SFN_TASK_TOKEN,
    output: JSON.stringify(event),
  });
  await sfn.send(successCommand);
});


const event = process.env.SFN_INPUT;
if (!event) {
  throw new Error('No event provided');
}

try {
  await handler(JSON.parse(event));
} catch (error) {
  console.error('Error:', error);
  const err = error as Error;
  const failureCommand = new SendTaskFailureCommand({
    taskToken: process.env.SFN_TASK_TOKEN,
    error: err.name,
    cause: JSON.stringify({ errorType: err.name, errorMessage: err.message }),
  });
  await sfn.send(failureCommand);
}
