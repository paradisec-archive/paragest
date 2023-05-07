import type { Handler } from 'aws-lambda';

type Event = {
  bucketName: string,
  objectKey: string,
  principalId: string
};

class StepError extends Error {
  constructor(message: string, principalId: string, data: Record<string, string>) {
    const error = JSON.stringify({ message, principalId, data });
    super(error);
    this.name = 'StepError';
  }
}

export const handler: Handler = async (event: Event) => {
  console.debug('S3 Data:', JSON.stringify(event, null, 2));

  const { bucketName, objectKey, principalId } = event;

  const md = objectKey.match(/^incoming\/([A-Za-z][a-zA-Z0-9_]+)-([A-Za-z][a-zA-Z0-9_]+)-(.*)\.([^.]+)$/);
  if (!md) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, principalId, { objectKey });
  }

  const [, collectionIdentifier, itemIdentifier, rest, extension] = md;

  const filename = `${collectionIdentifier}-${itemIdentifier}-${rest}.${extension}`;

  return {
    bucketName,
    objectKey,
    collectionIdentifier,
    itemIdentifier,
    filename,
    extension,
  };
};
