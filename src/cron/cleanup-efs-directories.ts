import fs from 'node:fs';
import path from 'node:path';

import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';

const EFS_MOUNT_PATH = '/mnt/efs';
const MAX_AGE_DAYS = 7;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export const handler: Handler = Sentry.wrapHandler(async (event: Event) => {
  console.log('Starting EFS directory cleanup', event);

  const entries = fs.readdirSync(EFS_MOUNT_PATH, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());

  console.log(`Found ${directories.length} directories to check`);

  const cutoffDate = new Date(Date.now() - MAX_AGE_MS);
  console.log(`Deleting directories older than ${cutoffDate.toISOString()}`);

  for (const dir of directories) {
    const dirPath = path.join(EFS_MOUNT_PATH, dir.name);
    const stats = fs.statSync(dirPath);

    if (stats.mtime < cutoffDate) {
      console.log(`Deleting old directory: ${dir.name} (last modified: ${stats.mtime.toISOString()})`);
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }

  console.log('Cleanup completed');
});
