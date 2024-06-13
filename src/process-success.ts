import type { Handler } from 'aws-lambda';

import * as Sentry from '@sentry/aws-serverless';

import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

import './lib/sentry.js';

import { sendEmail } from './lib/email';
import type { EmailUser } from './gql/graphql';

type Event = {
  notes: string[];
  principalId: string;
  bucketName: string;
  objectKey: string;
  objectSize: number;
  details: {
    itemIdentifier: string;
    collectionIdentifier: string;
    filename: string;
    extension: string;
  };
};

const s3 = new S3Client();

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.debug('Error:', JSON.stringify(event, null, 2));

  const {
    notes,
    details: { collectionIdentifier, itemIdentifier, filename },
    bucketName,
    objectKey,
    principalId,
  } = event;

  const deleteCommand = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  });
  console.debug('Deleting object from incoming bucket');
  await s3.send(deleteCommand);

  const subject = `${process.env.PARAGEST_ENV === 'stage' ? '[STAGE]' : ''}Success: ${collectionIdentifier}/${itemIdentifier}/${filename}`;
  const body = (admin: EmailUser | undefined | null, unikey: string) =>
    `
    Hi,
    ${!admin?.email ? `\nNOTE: The unikey ${unikey} doesn't exist in Nabu\n` : ''}
    File has been processed and placed in the catalog.

    ## Pipeline Notes
    ${notes.join('\n')}

    Cheers,
    Your friendly Paragest engine.
  `.replace(/^ {4}/gm, '');

  await sendEmail(principalId, subject, body);
});
