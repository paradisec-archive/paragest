import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { execute } from '../lib/command.js';
import { getPath } from '../lib/s3.js';

type Event = {
  notes: string[];
  details: {
    filename: string;
    extension: string;
  };
};

export const handler = async (event: Event) => {
  console.debug('Event: ', JSON.stringify(event, null, 2));

  const {
    notes,
    details: { filename, extension },
  } = event;

  const src = getPath('input');
  const dst = getPath(`output/${filename.replace(new RegExp(`.${extension}$`), '.tif')}`);

  execute(`convert '${src}' -compress lzw '${dst}'`, event);

  notes.push('create-archival: created TIFF');

  return event;
};

processBatch<Event>(handler);
