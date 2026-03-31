import { createWriteStream, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as Sentry from '@sentry/aws-serverless';

import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';
import { extractText } from '../lib/text-extraction.js';
import { updateEssence } from '../models/essence.js';

type BackfillEvent = {
  essenceId: string;
  s3Key: string;
  extension: string;
  mimetype: string;
  size: number;
};

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV not set');
}
const catalogBucket = `nabu-catalog-${process.env.PARAGEST_ENV}`;
const s3 = new S3Client();

const downloadToTmp = async (bucket: string, key: string): Promise<string> => {
  const filename = path.basename(key);
  const tmpPath = `/tmp/${Date.now()}-${filename}`;

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!Body) {
    throw new Error(`No body returned for s3://${bucket}/${key}`);
  }

  await new Promise((resolve, reject) => {
    (Body as Readable)
      .pipe(createWriteStream(tmpPath))
      .on('error', reject)
      .on('finish', resolve as () => void);
  });

  return tmpPath;
};

export const handler: Handler = Sentry.wrapHandler(async (event: BackfillEvent) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const { essenceId, s3Key, extension, mimetype, size } = event;

  const filePath = await downloadToTmp(catalogBucket, s3Key);

  try {
    const text = await extractText(filePath, extension);

    const [essence, error] = await updateEssence(essenceId, { extractedText: text, mimetype, size });
    if (!essence) {
      throw new Error(`Failed to update essence ${essenceId}: ${JSON.stringify(error)}`);
    }

    console.debug(`Updated essence ${essenceId}: ${text.length} characters`);

    return { essenceId, characters: text.length };
  } finally {
    unlinkSync(filePath);
  }
});
