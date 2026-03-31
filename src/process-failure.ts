import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';

import './lib/sentry.js';

import { sendEmail } from './lib/email';
import { move } from './lib/s3.js';
import type { EmailUser } from './models/user';

type Event = {
  Cause: string;
};
type ErrorData = {
  message: string;
  event: Record<string, string> & { bucketName: string; objectKey: string; principalId: string; notes: string[] };
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

  // Strip extractedText from data and any nested objects to avoid bloating error emails
  const sanitiseData = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'extractedText' && typeof value === 'string' && value.length > 500) {
        result[key] = `${value.slice(0, 500)}... [truncated, ${value.length} characters total]`;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = sanitiseData(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  const sanitisedData = sanitiseData(data);
  console.debug({ message, principalId, data: sanitisedData });

  if (!objectKey) {
    throw new Error('No object key');
  }

  console.debug('Moving object to rejected bucket');
  await move(bucketName, objectKey, bucketName, objectKey.replace(/^(incoming|damsmart)/, 'rejected'));

  const subject = `${process.env.PARAGEST_ENV === 'stage' ? '[STAGE]' : ''}Paragest Error: ${message}`;
  const body = (admin: EmailUser | undefined | null, unikey: string) =>
    `
    Hi,

    ${!admin?.email ? `\nNOTE: The unikey ${unikey} doesn't exist in Nabu\n` : ''}

    The following error was encountered in the ingestion pipeline:

      ${message}

    The following data was provided:

      ${JSON.stringify(sanitisedData, null, 2)}

    ## Pipeline Notes
    ${notes.join('\n')}

    Cheers,
    Your friendly Paragest engine.
  `.replace(/^ {4}/gm, '');

  await sendEmail(principalId, subject, body);
});
