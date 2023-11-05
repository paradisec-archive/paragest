import type { Handler } from 'aws-lambda';

import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sendEmail } from './lib/email';
import { EmailUser } from './gql/graphql';

type Event = {
  principalId: string,
  bucketName: string,
  objectKey: string,
  objectSize: number
  details: {
    itemIdentifier: string,
    collectionIdentifier: string,
    filename: string,
    extension: string,
  },
};

const s3 = new S3Client();

export const handler: Handler = async (event: Event) => {
  console.debug('Error:', JSON.stringify(event, null, 2));

  const {
    details: {
      collectionIdentifier,
      itemIdentifier,
      filename,
    },
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

  const subject = `Paraget Success: ${collectionIdentifier}/${itemIdentifier}/${filename}`;
  const body = (admin: EmailUser | undefined | null, unikey: string) => `
    Hi,

    ${!admin?.email && `NOTE: The unikey ${unikey} doesn't exist in Nabu`}

    File has been processed and placed in the catalog.

    Cheers,
    Your friendly Paraget engine.
  `.replace(/^ {4}/gm, '');

  await sendEmail(principalId, subject, body);
};
