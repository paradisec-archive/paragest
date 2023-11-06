import { graphql } from '../gql';

import { getGraphQLClient } from '../lib/graphql.js';

const gqlClient = await getGraphQLClient();

export const getUserByUnikey = async (unikey: string) => {
  const UserByUnikeyQuery = graphql(/* GraphQL */ `
    query GetUserByUnikeyQuery($unikey: String!) {
      userByUnikey(unikey: $unikey) {
        email
        firstName
        lastName
      }
    }
  `);

  const response = await gqlClient.query(UserByUnikeyQuery, { unikey });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.userByUnikey;
};
