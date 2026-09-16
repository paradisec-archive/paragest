import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';

import './lib/sentry.js';

import { sendEmail } from './lib/email';
import { type FailureEvent, unpackFailure } from './lib/failure-payload.js';
import { move } from './lib/s3.js';
import type { EmailUser } from './models/user';

// Strip extractedContent from data and any nested objects to avoid bloating error emails
const sanitiseData = (obj: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'extractedContent' && value && typeof value === 'object') {
      result[key] = '[extracted content omitted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitiseData(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
};

export const handler: Handler = Sentry.wrapHandler(async (event: FailureEvent) => {
  console.debug('Error:', JSON.stringify(event, null, 2));

  const { message, data, bucketName, objectKey, principalId, notes } = unpackFailure(event);

  const sanitisedData = sanitiseData(data);
  console.debug({ message, principalId, data: sanitisedData });

  if (!bucketName || !objectKey) {
    throw new Error(`No object key in failure payload: ${message}`);
  }

  // Move before emailing: leaving a file in incoming/ strands it silently, whereas a
  // failed email still leaves a rejected file and a Lambda error to alarm on
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
