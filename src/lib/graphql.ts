import https from 'node:https';

import { Client, fetchExchange } from '@urql/core';

import { getSecret } from './secrets.js';

type OAuthSecret = {
  clientId: string;
  clientSecret: string;
};

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV is not set');
}
const apiUrl = `https://${process.env.NABU_DNS_NAME}`;

const tlsHostname =
  process.env.PARAGEST_ENV === 'prod' ? 'catalog.nabu-prod.paradisec.org.au' : 'catalog.nabu-stage.paradisec.org.au';

const customFetch: typeof fetch = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const requestOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers as https.RequestOptions['headers'],
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const response = {
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
          blob: () => Promise.resolve(Buffer.from(data)),
          arrayBuffer: () => Promise.resolve(Buffer.from(data).buffer),
        };
        resolve(response as unknown as Awaited<ReturnType<typeof fetch>>);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    // Handle request body if provided
    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
};

const getAccessToken = async (credentials: OAuthSecret): Promise<string> => {
  console.log('🪚 🔵 GA');
  const tokenUrl = `${apiUrl}/oauth/token`;
  const tokenRequestData = {
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: 'public admin',
  };

  try {
    console.log('🪚 ⭕');
    const tokenResponse = await customFetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: tlsHostname,
      },
      body: JSON.stringify(tokenRequestData),
    });
    console.log('🪚 ⭐');

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    if (!tokenData.access_token) {
      throw new Error(`No access token returned: ${JSON.stringify(tokenData)}`);
    }

    return tokenData.access_token;
  } catch (error) {
    const err = error as Error;
    console.log(error);
    throw new Error(`Failed to fetch access token: ${err.message}`);
  }
};

export const getGraphQLClient = async () => {
  console.log('🪚 💜');
  const oauthCredentials = await getSecret<OAuthSecret>('/paragest/nabu/oauth');

  const accessToken = await getAccessToken(oauthCredentials);

  const client = new Client({
    url: `${apiUrl}/api/v1/graphql`,
    exchanges: [fetchExchange],
    fetchOptions: () => ({
      headers: { authorization: `Bearer ${accessToken}`, host: tlsHostname },
    }),
    fetch: customFetch,
  });

  return client;
};
