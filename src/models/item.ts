import { graphql } from '../gql';

import { getGraphQLClient } from '../lib/graphql.js';

const gqlClient = await getGraphQLClient();

export const getItem = async (collectionIdentifier: string, itemIdentifier: string) => {
  const ItemQuery = graphql(/* GraphQL */ `
    query GetItemQuery($fullIdentifier: ID!) {
      item(fullIdentifier: $fullIdentifier) {
        full_identifier
        title
        metadata_exportable

        created_at
        updated_at
      }
    }
  `);

  const response = await gqlClient.query(ItemQuery, { fullIdentifier: `${collectionIdentifier}-${itemIdentifier}` });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.item;
};
