import { SecretsManager, type GetSecretValueCommandInput } from '@aws-sdk/client-secrets-manager';

const secretsmanager = new SecretsManager({});

export const getSecret = async <SecretType>(secretId: string): Promise<SecretType> => {
  const params: GetSecretValueCommandInput = { SecretId: secretId };
  const secret = await secretsmanager.getSecretValue(params);

  if (!secret.SecretString) {
    throw new Error(`Secret ${secretId} does not contain a SecretString`);
  }

  console.debug(`Secret ${secretId} contents:`, secret.SecretString);

  return JSON.parse(secret.SecretString);
};
