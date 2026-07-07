import fs from 'node:fs';

import '../lib/sentry-node.js';

import { v4 as uuidv4 } from 'uuid';

import { getMediaMetadata, isTextExtractable, lookupMimetypeFromExtension } from '../lib/media.js';
import { download, getObjectSize, getPath } from '../lib/s3.js';
import { extractContent } from '../lib/text-extraction.js';
import { createEssence, getEssence } from '../models/essence.js';
import { getItem } from '../models/item.js';

type Input = {
  keys: string[];
  dryRun?: boolean;
};

type Status = 'created' | 'wouldCreate' | 'alreadyExists' | 'itemMissing' | 'error';

type Result = {
  key: string;
  status: Status;
  collectionIdentifier?: string;
  itemIdentifier?: string;
  filename?: string;
  essenceId?: string;
  attributes?: Record<string, unknown>;
  error?: string;
};

if (!process.env.PARAGEST_ENV) {
  throw new Error('PARAGEST_ENV not set');
}
const env = process.env.PARAGEST_ENV;
const catalogBucket = `nabu-catalog-${env}`;

// Catalog objects live at `<collectionIdentifier>/<itemIdentifier>/<filename>` where the
// filename is itself `<collectionIdentifier>-<itemIdentifier>-<rest>.<extension>`.
const parseKey = (rawKey: string) => {
  // Accept `s3://nabu-catalog-<env>/<key>`, a leading slash, or a bare key.
  const key = rawKey
    .replace(/^s3:\/\/[^/]+\//, '')
    .replace(/^\/+/, '')
    .trim();

  const parts = key.split('/');
  if (parts.length !== 3) {
    throw new Error(`Key ${rawKey} is not a <collection>/<item>/<filename> catalog path`);
  }

  const [collectionIdentifier, itemIdentifier, filename] = parts as [string, string, string];

  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension || extension === filename) {
    throw new Error(`Filename ${filename} has no extension`);
  }

  return { key, collectionIdentifier, itemIdentifier, filename, extension };
};

// Builds the essence attributes, downloading the object only when the bytes are actually
// needed: audio/video need mediainfo, text types need extraction. Everything else (images,
// other) only needs size (from a HEAD) + mimetype, so we never download those.
const buildAttributes = async (key: string, filename: string, extension: string, mimetype: string) => {
  const attributes: Record<string, unknown> = {
    mimetype,
    size: await getObjectSize(catalogBucket, key),
  };

  const isMedia = mimetype.startsWith('audio') || mimetype.startsWith('video');
  const isText = !isMedia && isTextExtractable(extension);
  if (!isMedia && !isText) {
    return attributes;
  }

  await download(catalogBucket, key, filename);
  try {
    if (isMedia) {
      const { other: _other, rawFps: _rawFps, ...mediaAttributes } = await getMediaMetadata(getPath(filename), { key });
      Object.assign(attributes, mediaAttributes);
    } else {
      try {
        const content = await extractContent(getPath(filename), extension);
        if (content) {
          attributes.extractedContent = content;
        }
      } catch (error) {
        // Text extraction is best-effort: still create the essence with size + mimetype.
        console.warn(`extractContent failed for ${key}:`, error);
      }
    }
  } finally {
    fs.rmSync(getPath(filename), { force: true });
  }

  return attributes;
};

const processKey = async (rawKey: string, dryRun: boolean): Promise<Result> => {
  let parsed: ReturnType<typeof parseKey> | undefined;
  try {
    parsed = parseKey(rawKey);
    const { key, collectionIdentifier, itemIdentifier, filename, extension } = parsed;

    const base: Result = { key, status: 'error', collectionIdentifier, itemIdentifier, filename };

    const mimetype = lookupMimetypeFromExtension(extension);
    if (!mimetype) {
      return { ...base, error: `Unsupported file extension: ${extension}` };
    }

    const item = await getItem(collectionIdentifier, itemIdentifier);
    if (!item) {
      return { ...base, status: 'itemMissing', error: `Item ${collectionIdentifier}-${itemIdentifier} not in catalog` };
    }

    const existing = await getEssence(collectionIdentifier, itemIdentifier, filename);
    if (existing) {
      return { ...base, status: 'alreadyExists', essenceId: existing.id };
    }

    const attributes = await buildAttributes(key, filename, extension, mimetype);

    if (dryRun) {
      return { ...base, status: 'wouldCreate', attributes };
    }

    const [created, error] = await createEssence(collectionIdentifier, itemIdentifier, filename, attributes as Parameters<typeof createEssence>[3]);
    if (!created) {
      return { ...base, attributes, error: `createEssence failed: ${JSON.stringify(error)}` };
    }

    return { ...base, status: 'created', attributes };
  } catch (error) {
    const err = error as Error;
    return { key: parsed?.key ?? rawKey, status: 'error', ...parsed, error: err.message };
  }
};

const run = async () => {
  const raw = process.env.RECREATE_INPUT;
  if (!raw) {
    throw new Error('RECREATE_INPUT env var not set (expected JSON: { "keys": [...], "dryRun"?: boolean })');
  }

  const input = JSON.parse(raw) as Input;
  if (!Array.isArray(input.keys) || input.keys.length === 0) {
    throw new Error('RECREATE_INPUT.keys must be a non-empty array');
  }
  const dryRun = input.dryRun ?? true;

  // getPath()/execute() key their working directory off SFN_ID; give this run its own.
  process.env.SFN_ID = uuidv4();
  fs.mkdirSync(getPath(''), { recursive: true });

  console.log(`recreate-essence: processing ${input.keys.length} key(s), dryRun=${dryRun}`);

  const results: Result[] = [];
  // Sequential so only one (potentially large) media file is on disk at a time.
  for (const key of input.keys) {
    const result = await processKey(key, dryRun);
    console.log(JSON.stringify(result));
    results.push(result);
  }

  const summary = results.reduce<Partial<Record<Status, number>>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log('recreate-essence: summary', JSON.stringify({ dryRun, summary, results }, null, 2));

  // Surface hard errors as a non-zero exit so Batch marks the job failed.
  if (results.some((r) => r.status === 'error')) {
    process.exitCode = 1;
  }
};

await run();
