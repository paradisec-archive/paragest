import { SecretsManager, type GetSecretValueCommandInput } from '@aws-sdk/client-secrets-manager';

import type { Handler } from 'aws-lambda';

import { gql, GraphQLClient } from 'graphql-request';

const secretsmanager = new SecretsManager({});

type Event = {
  bucketName: string,
  objectKey: string,
  principalId: string
};

type OAuthSecret = {
  clientId: string,
  clientSecret: string,
};

class StepError extends Error {
  constructor(message: string, principalId: string, data: Record<string, string>) {
    const error = JSON.stringify({ message, principalId, data });
    super(error);
    this.name = 'StepError';
  }
}

const getSecret = async <SecretType>(secretId: string): Promise<SecretType> => {
  const params: GetSecretValueCommandInput = { SecretId: secretId };
  const secret = await secretsmanager.getSecretValue(params);

  if (!secret.SecretString) {
    throw new Error(`Secret ${secretId} does not contain a SecretString`);
  }

  console.debug(`Secret ${secretId} contents:`, secret.SecretString);

  return JSON.parse(secret.SecretString);
};

const apiUrl = 'https://catalog.paradisec.org.au';

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
  const accessToken = tokenData.access_token;

  return accessToken;
};

export const handler: Handler = async (event: Event) => {
  console.debug('S3 Data:', JSON.stringify(event, null, 2));

  const { bucketName, objectKey, principalId } = event;

  const md = objectKey.match(/^incoming\/([A-Za-z][a-zA-Z0-9_]+)-([A-Za-z][a-zA-Z0-9_]+)-(.*)\.([^.]+)$/);
  if (!md) {
    throw new StepError(`Object key ${objectKey} does not match expected pattern`, principalId, { objectKey });
  }

  const [, collectionIdentifier, itemIdentifier, rest, extension] = md;

  const filename = `${collectionIdentifier}-${itemIdentifier}-${rest}.${extension}`;

  console.debug('Filename:', filename);
  const oauthCredentials = await getSecret<OAuthSecret>('/paragest/nabu/oauth');
  console.debug('OAuth Credentials:', oauthCredentials);
  const accessToken = await getAccessToken(oauthCredentials);
  console.debug('Access Token:', accessToken);

  const graphQLClient = new GraphQLClient(`${apiUrl}/api/v1/graphql`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const document = gql`
    {
      item(fullIdentifier: "${collectionIdentifier}-${itemIdentifier}") {
        full_identifier
        title
      }
    }
  `;

  const response = await graphQLClient.request(document);

  console.debug('MOO', JSON.stringify(response, null, 2));

  return {
    bucketName,
    objectKey,
    collectionIdentifier,
    itemIdentifier,
    filename,
    extension,
  };
};
