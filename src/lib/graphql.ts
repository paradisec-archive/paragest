import { Client, type CombinedError, fetchExchange } from '@urql/core';
import fetch from 'node-fetch';

import { getSecret } from './secrets.js';

type OAuthSecret = {
  clientId: string;
  clientSecret: string;
};

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV is not set');
}
const apiUrl = `https://${process.env.NABU_DNS_NAME}`;

const tlsHostname = `admin-catalog.nabu-${process.env.PARAGEST_ENV}.paradisec.org.au`;

const MAX_ATTEMPTS = 5;
const BASE_DELAY = 500;
const JITTER = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class TokenError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'TokenError';
    this.retryable = retryable;
  }
}

const requestAccessToken = async (credentials: OAuthSecret): Promise<string> => {
  const tokenUrl = `${apiUrl}/oauth/token`;
  const tokenRequestData = {
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: 'public admin',
  };

  let tokenResponse: Awaited<ReturnType<typeof fetch>>;
  try {
    tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: tlsHostname,
        'User-Agent': 'paragest',
      },
      body: JSON.stringify(tokenRequestData),
    });
  } catch (error) {
    throw new TokenError(`request failed: ${(error as Error).message}`, true);
  }

  const body = await tokenResponse.text();

  if (!tokenResponse.ok) {
    // 429 and 5xx are Nabu being overloaded; anything else is our request being wrong
    const retryable = tokenResponse.status === 429 || tokenResponse.status >= 500;
    throw new TokenError(`${tokenResponse.status} ${tokenResponse.statusText}: ${body.slice(0, 200)}`, retryable);
  }

  let tokenData: { access_token?: string };
  try {
    tokenData = JSON.parse(body) as { access_token?: string };
  } catch {
    // Nabu's proxy answers 200 with an HTML error page when it's struggling
    throw new TokenError(`non-JSON response: ${body.slice(0, 200)}`, true);
  }

  if (!tokenData.access_token) {
    throw new TokenError(`no access token returned: ${body.slice(0, 200)}`, false);
  }

  return tokenData.access_token;
};

const getAccessToken = async (credentials: OAuthSecret): Promise<string> => {
  let lastError: TokenError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestAccessToken(credentials);
    } catch (error) {
      lastError = error as TokenError;
      console.log(`Access token attempt ${attempt}/${MAX_ATTEMPTS} failed:`, lastError.message);

      if (!lastError.retryable || attempt === MAX_ATTEMPTS) {
        break;
      }

      await sleep(BASE_DELAY * 2 ** (attempt - 1) + Math.random() * JITTER);
    }
  }

  throw new Error(`Failed to fetch access token: ${lastError?.message}`);
};

const createGraphQLClient = async () => {
  const oauthCredentials = await getSecret<OAuthSecret>('/paragest/nabu/oauth');

  const accessToken = await getAccessToken(oauthCredentials);

  return new Client({
    url: `${apiUrl}/graphql`,
    preferGetMethod: false,
    exchanges: [fetchExchange],
    fetchOptions: () => ({
      headers: { authorization: `Bearer ${accessToken}`, host: tlsHostname, 'User-Agent': 'paragest' },
    }),
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
};

let clientPromise: Promise<Client> | undefined;

// Built on first use, never at module load: a handler that imports a model must still
// be able to run (and report the failure it was invoked for) while Nabu is unreachable
export const getGraphQLClient = async () => {
  if (!clientPromise) {
    clientPromise = createGraphQLClient();
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }

  return clientPromise;
};

export const isNotFoundError = (error: CombinedError): boolean =>
  !error.networkError && error.graphQLErrors.length > 0 && error.graphQLErrors.every((e) => /^\w+ not found$/i.test(e.message));
