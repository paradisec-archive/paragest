import { graphql } from '../gql';

import { getGraphQLClient } from '../lib/graphql.js';

const gqlClient = await getGraphQLClient();

export const getCollection = async (identifier: string) => {
  const query = graphql(/* GraphQL */ `
    query GetCollectionQuery($identifier: ID!) {
      collection(identifier: $identifier) {
        identifier
        title
      }
    }
  `);

  const response = await gqlClient.query(query, { identifier });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.collection;
};
