import { graphql } from '../gql';

import { getGraphQLClient, isNotFoundError } from '../lib/graphql.js';
import { throttle } from '../lib/rate-limit';

const gqlClient = await getGraphQLClient();

export const getUserByUnikey = throttle(async (unikey: string) => {
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

  if (response.error) {
    if (isNotFoundError(response.error)) return null;
    throw response.error;
  }

  return response.data?.userByUnikey ?? null;
});

// We should be able to get this via codgen but it's not being pulled in
export type EmailUser = Awaited<ReturnType<typeof getUserByUnikey>>;
