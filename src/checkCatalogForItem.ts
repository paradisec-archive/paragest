import type { Handler } from 'aws-lambda';

import { gql } from 'graphql-request';

import { StepError } from './lib/errors.js';
import { getGraphQLClient } from './lib/graphql.js';

type Event = {
  bucketName: string,
  objectKey: string,
  principalId: string
};

export const handler: Handler = async (event: Event) => {
  console.debug('S3 Data:', JSON.stringify(event, null, 2));

  const { bucketName, objectKey, principalId } = event;

  const md = objectKey.match(/^incoming\/([A-Za-z][a-zA-Z0-9_]+)-([A-Za-z][a-zA-Z0-9_]+)-(.*)\.([^.]+)$/);
  if (!md) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, principalId, { objectKey });
  }

  const [, collectionIdentifier, itemIdentifier, rest, extension] = md;

  const filename = `${collectionIdentifier}-${itemIdentifier}-${rest}.${extension}`;
  console.debug('Filename:', filename);

  const document = gql`
    {
      item(fullIdentifier: "${collectionIdentifier}-${itemIdentifier}") {
        full_identifier
        title
      }
    }
  `;

  const graphQLClient = await getGraphQLClient();
  const response = await graphQLClient.request(document);

  console.debug('MOO', JSON.stringify(response, null, 2));

  return {
    bucketName,
    objectKey,
    collectionIdentifier,
    itemIdentifier,
    filename,
    extension,
  };
};
