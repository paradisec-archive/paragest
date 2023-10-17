import type { Handler } from 'aws-lambda';

import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

type Event = {
  Cause: string,
}
type ErrorData = {
  message: string,
  event: Record<string, string> & { principalId: string }
  data: Record<string, string>,
};

const s3 = new S3Client();

export const handler: Handler = async (event: Event) => {
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

  const to = principalId.replace(/.*:/, '');
  const cc = 'admin@paradisec.org';
  const subject = `Paraget Error: ${message}`;
  const body = `
    Hi,

    The following error was encountered in the ingestion pipeline:

      ${message}

    The following data was provided:

      ${JSON.stringify(data, null, 2)}

    Cheers,
    Your friendly Paraget engine.
  `;

  console.error(to);
  console.error(cc);
  console.error(subject);
  console.error(body);

  // TODO: Send an email
};
