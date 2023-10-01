import { GraphQLClient } from 'graphql-request';

import { getSecret } from './secrets.js';

type OAuthSecret = {
  clientId: string,
  clientSecret: string,
};

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV is not set');
}
const apiUrl = `https://catalog.nabu-${process.env.PARAGEST_ENV}.paradisec.org.au`;

const getAccessToken = async (credentials: OAuthSecret): Promise<string> => {
  const tokenUrl = `${apiUrl}/oauth/token`;
  const tokenRequestData = {
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  };

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tokenRequestData),
  });
  const tokenData = await tokenResponse.json();

  return tokenData.access_token;
};

export const getGraphQLClient = async (): Promise<GraphQLClient> => {
  const oauthCredentials = await getSecret<OAuthSecret>('/paragest/nabu/oauth');

  const accessToken = await getAccessToken(oauthCredentials);

  const graphQLClient = new GraphQLClient(`${apiUrl}/api/v1/graphql`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  return graphQLClient;
};
