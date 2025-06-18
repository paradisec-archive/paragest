import fs from 'node:fs';

import '../lib/sentry-node.js';

import { processBatch } from '../lib/batch.js';
import { StepError } from '../lib/errors.js';
import { getMediaMetadata, lookupMimetypeFromExtension } from '../lib/media.js';
import { getPath, upload } from '../lib/s3.js';
import { createEssence, getEssence, updateEssence } from '../models/essence.js';
import path from 'node:path';

type Event = {
  id: string;
  notes: string[];
  bucketName: string;
  objectKey: string;
  details: {
    collectionIdentifier: string;
    itemIdentifier: string;
    filename: string;
  };
};

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV not set');
}
const env = process.env.PARAGEST_ENV;

const destBucket = `nabu-catalog-${env}`;

const upsertEssence = async (
  collectionIdentifier: string,
  itemIdentifier: string,
  filename: string,
  src: string,
  size: number,
  mimetype: string,
  event: Event,
) => {
  const attributes = {
    mimetype,
    size,
  };

  if (mimetype.startsWith('audio') || mimetype.startsWith('video')) {
    const { other, ...mediaAttributes } = await getMediaMetadata(getPath(src), event); // eslint-disable-line @typescript-eslint/no-unused-vars
    Object.assign(attributes, mediaAttributes);
  }

  console.debug('Attributes:', JSON.stringify(attributes, null, 2));

  const essence = await getEssence(collectionIdentifier, itemIdentifier, filename);
  if (essence) {
    const [updatedEssence, error] = await updateEssence(essence.id, attributes);
    if (!updatedEssence) {
      throw new StepError(`${filename}: Couldn't update essence`, event, { error, attributes });
    }
    return false;
  }

  const [createdEssence, error] = await createEssence(collectionIdentifier, itemIdentifier, filename, attributes);
  if (!createdEssence) {
    throw new StepError(`${filename}: Couldn't create essence`, event, { error, attributes });
  }
  return true;
};

export const handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  process.env.SFN_ID = event.id;

  const {
    notes,
    details: { collectionIdentifier, itemIdentifier },
  } = event;

  const dir = getPath('output');

  const filenames = fs.readdirSync(dir);

  const promises = filenames.map(async (filename) => {
    const extension = filename.split('.').pop();
    if (!extension) {
      throw new StepError(`${filename}: No extension, should be impossible`, event, { filename });
    }

    const mimetype = lookupMimetypeFromExtension(extension);
    if (!mimetype) {
      throw new StepError(`${filename}: Unsupported file extension, should be impossible`, event, { extension });
    }

    const src = path.join(dir, filename);

    const { size } = fs.statSync(src);

    const dst = `${collectionIdentifier}/${itemIdentifier}/${filename}`;

    notes.push(`addToCatalog: Uploading ${src} to catalog`);

    await upload(src, destBucket, dst, mimetype, ['wav', 'mkv'].includes(extension));

    const created = await upsertEssence(collectionIdentifier, itemIdentifier, filename, dst, size, mimetype, event);

    notes.push(`addMediaMetadata: ${created ? 'Created' : 'Updated'} essence`);
  });

  await Promise.all(promises || []);

  return event;
};

processBatch<Event>(handler);
