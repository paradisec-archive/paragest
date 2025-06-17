import { graphql } from '../gql';

import { getGraphQLClient } from '../lib/graphql.js';
import { throttle } from '../lib/rate-limit';

const gqlClient = await getGraphQLClient();

export const getCollection = throttle(async (identifier: string) => {
  const CollectionQuery = graphql(/* GraphQL */ `

    query GetCollectionQuery($identifier: ID!) {
      collection(identifier: $identifier) {
        identifier
        title
      }
    }
  `);

  console.log('🪚 ⭐ GC');
  const response = await gqlClient.query(CollectionQuery, { identifier });
  console.log('🪚 🔲 GC');
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.collection;
});

export const setHasDepositForm = throttle(async (identifier: string) => {
  const query = graphql(/* GraphQL */ `
    mutation SetCollectionHasDepositForm($input: SetCollectionHasDepositFormInput!) {
      setCollectionHasDepositForm(input: $input) {
        clientMutationId
      }
    }
  `);

  const params = {
    identifier,
  };

  const updateResponse = await gqlClient.mutation(query, { input: params });
  console.debug('UpdateResponse:', JSON.stringify(updateResponse, null, 2));

  return updateResponse.error;
});
