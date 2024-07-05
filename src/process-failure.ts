import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import './lib/sentry.js';

import { sendEmail } from './lib/email';
import type { EmailUser } from './gql/graphql';
import { copy, destroy, list } from './lib/s3.js';

type Event = {
  Cause: string;
};
type ErrorData = {
  message: string;
  event: Record<string, string> & { bucketName: string, objectKey: string, principalId: string; notes: string[] };
  data: Record<string, string>;
};

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Error:', JSON.stringify(event, null, 2));

  const { Cause } = event;
  const { errorMessage } = JSON.parse(Cause);
  const {
    message,
    event: { principalId, bucketName, objectKey, notes },
    data,
  } = JSON.parse(errorMessage) as ErrorData;
  console.debug({ message, principalId, data });

  if (!objectKey) {
    throw new Error('No object key');
  }

  console.debug('Copying object to rejected bucket');
  await copy(bucketName, objectKey, bucketName, objectKey.replace(/^incoming/, 'rejected'));

  console.debug('Deleting object from incoming bucket');
  await destroy(bucketName, objectKey);

  console.debug('Deleting any output files');
  const prefix = objectKey.replace(/^incoming/, 'output');
  const objects = await list(bucketName, prefix);

  await Promise.all(objects.map((object) => object.Key && destroy(bucketName, object.Key)));

  const subject = `${process.env.PARAGEST_ENV === 'stage' ? '[STAGE]' : ''}Paragest Error: ${message}`;
  const body = (admin: EmailUser | undefined | null, unikey: string) =>
    `
    Hi,

    ${!admin?.email ? `\nNOTE: The unikey ${unikey} doesn't exist in Nabu\n` : ''}

    The following error was encountered in the ingestion pipeline:

      ${message}

    The following data was provided:

      ${JSON.stringify(data, null, 2)}

    ## Pipeline Notes
    ${notes.join('\n')}

    Cheers,
    Your friendly Paragest engine.
  `.replace(/^ {4}/gm, '');

  await sendEmail(principalId, subject, body);
});
