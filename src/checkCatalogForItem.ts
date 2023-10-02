import type { Handler } from 'aws-lambda';

import { graphql } from './gql';

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

  const ItemQuery = graphql(/* GraphQL */ `
    query GetItemQuery($fullIdentifier: ID!) {
      item(fullIdentifier: $fullIdentifier) {
        full_identifier
        title
      }
    }
  `);

  const gqlClient = await getGraphQLClient();
  const response = await gqlClient.query(ItemQuery, { fullIdentifier: `${collectionIdentifier}-${itemIdentifier}` });

  if (!response.data?.item) {
    throw new StepError(`File ${filename} is for collection: ${collectionIdentifier} item: ${itemIdentifier} but that is not in the database`, principalId, { objectKey });
  }

  return {
    bucketName,
    objectKey,
    collectionIdentifier,
    itemIdentifier,
    filename,
    extension,
  };
};
