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

  if (!unikey) {
    console.debug('No unikey provided');
  }

  const response = await gqlClient.query(UserByUnikeyQuery, { unikey });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.userByUnikey;
};

// We should be able to get this via codgen but it's not being pulled in
export type EmailUser = Awaited<ReturnType<typeof getUserByUnikey>>;
