import '../lib/sentry-node.js';

import { processBatch } from './lib/batch.js';
import { StepError } from './lib/errors.js';
import { getMediaMetadata, lookupMimetypeFromExtension } from './lib/media.js';
import { list, move } from './lib/s3.js';
import { createEssence, getEssence, updateEssence } from './models/essence.js';

type Event = {
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
  fileKey: string,
  size: number,
  event: Event,
) => {
  const extension = filename.split('.').pop();
  if (!extension) {
    throw new StepError(`${filename}: No extension, should be impossible`, event, { filename });
  }

  const mimetype = lookupMimetypeFromExtension(extension);
  if (!mimetype) {
    throw new StepError(`${filename}: Unsupported file extension, should be impossible`, event, { extension });
  }

  const attributes = {
    mimetype,
    size,
  };

  if (mimetype.startsWith('audio') || mimetype.startsWith('video')) {
    console.debug('Getting media metadata', destBucket, fileKey);
    const { other, ...mediaAttributes } = await getMediaMetadata(destBucket, fileKey, event); // eslint-disable-line @typescript-eslint/no-unused-vars
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
  const {
    notes,
    bucketName,
    details: { collectionIdentifier, itemIdentifier, filename },
  } = event;

  const prefix = `output/${filename}`;
  const objects = await list(bucketName, prefix);

  const promises = objects.map(async (object) => {
    if (!object.Key || !object.Size) {
      throw new Error(`No object key or size ${JSON.stringify(object)}`);
    }

    const source = object.Key;
    const newFilename = object.Key.replace(`${prefix}/`, '');
    const dest = `${collectionIdentifier}/${itemIdentifier}/${newFilename}`;

    notes.push(`addToCatalog: Copying ${source} to catalog`);
    await move(bucketName, source, destBucket, dest);

    const created = await upsertEssence(collectionIdentifier, itemIdentifier, newFilename, dest, object.Size, event);
    notes.push(`addMediaMetadata: ${created ? 'Created' : 'Updated'} essence`);
  });

  await Promise.all(promises || []);

  return event;
};

processBatch<Event>(handler);
