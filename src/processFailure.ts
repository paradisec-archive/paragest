import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/serverless';

import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

import './lib/sentry.js';

import { sendEmail } from './lib/email';
import { EmailUser } from './gql/graphql';

type Event = {
  Cause: string,
}
type ErrorData = {
  message: string,
  event: Record<string, string> & { principalId: string }
  data: Record<string, string>,
};

const s3 = new S3Client();

export const handler: Handler = Sentry.AWSLambda.wrapHandler(async (event: Event) => {
  console.debug('Error:', JSON.stringify(event, null, 2));

  const { Cause } = event;
  const { errorMessage } = JSON.parse(Cause);
  const { message, event: { principalId, bucketName, objectKey }, data } = JSON.parse(errorMessage) as ErrorData;
  console.debug({ message, principalId, data });

  const copyCommand = new CopyObjectCommand({
    Bucket: bucketName,
    CopySource: `${bucketName}/${objectKey}`,
    Key: objectKey!.replace(/^incoming/, 'rejected'),
    ChecksumAlgorithm: 'SHA256',
  });
  console.debug('Copying object to rejected bucket');
  await s3.send(copyCommand);

  const deleteCommand = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  });
  console.debug('Deleting object from incoming bucket');
  await s3.send(deleteCommand);

  const subject = `Paraget Error: ${message}`;
  const body = (admin: EmailUser | undefined | null, unikey: string) => `
    Hi,
${!admin?.email ? `\nNOTE: The unikey ${unikey} doesn't exist in Nabu\n` : ''}
    The following error was encountered in the ingestion pipeline:

      ${message}

    The following data was provided:

      ${JSON.stringify(data, null, 2)}

    Cheers,
    Your friendly Paraget engine.
  `.replace(/^ {4}/gm, '');

  await sendEmail(principalId, subject, body);
});
