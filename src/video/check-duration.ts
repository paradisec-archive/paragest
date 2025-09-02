import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { getMediaMetadata } from '../lib/media.js';
import { getPath } from '../lib/s3.js';
import { StepError } from '../lib/errors.js';

type Event = {
  id: string;
  notes: string[];
  details: {
    filename: string;
    extension: string;
  };
};

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { filename },
  } = event;

  const src = getPath('input');

  const { duration } = await getMediaMetadata(src, event);

  notes.push(`create-archival: Duration: ${duration}`);

  if (duration > 60 * 60) {
    throw new StepError(`${filename}: Video is longer than 1 hour`, event, { duration });
  }

  return event;
};

processBatch<Event>(handler);
