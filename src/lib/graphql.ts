import { Client, fetchExchange } from '@urql/core';

import { getSecret } from './secrets.js';

type OAuthSecret = {
  clientId: string;
  clientSecret: string;
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
    scope: 'read admin',
  };

  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tokenRequestData),
    });

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    if (!tokenData.access_token) {
      throw new Error(`No access token returned: ${JSON.stringify(tokenData)}`);
    }

    return tokenData.access_token;
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to fetch access token: ${err.message}`);
  }
};

export const getGraphQLClient = async () => {
  const oauthCredentials = await getSecret<OAuthSecret>('/paragest/nabu/oauth');

  const accessToken = await getAccessToken(oauthCredentials);

  const client = new Client({
    url: `${apiUrl}/api/v1/graphql`,
    exchanges: [fetchExchange],
    fetchOptions: () => ({
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  });

  return client;
};
