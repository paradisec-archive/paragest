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

export const getItemBwfCsv = async (collectionIdentifier: string, itemIdentifier: string, filename: string) => {
  const ItemBwfCsvQuery = graphql(/* GraphQL */ `
    query GetItemBwfCsvQuery($fullIdentifier: ID!, $filename: String!) {
      itemBwfCsv(fullIdentifier: $fullIdentifier, filename: $filename) {
        csv
      }
    }
  `);

  const response = await gqlClient.query(ItemBwfCsvQuery, { fullIdentifier: `${collectionIdentifier}-${itemIdentifier}`, filename });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.itemBwfCsv?.csv;
};
