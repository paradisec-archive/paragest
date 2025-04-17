import { execSync } from 'node:child_process';

import * as Sentry from '@sentry/node';

import { StepError } from './errors.js';

interface ExecSyncError extends Error {
  stdout?: Buffer;
}

export const execute = (command: string, event: Record<string, string | number | object>) => {
  if (!process.env.AWS_BATCH_JOB_ID) {
    throw new StepError('AWS_BATCH_JOB_ID is not set - contact John ', event, { error: 'AWS_BATCH_JOB_ID not set' });
  }

  try {
    const cmd = `${command} 2>&1`;

    const output = execSync(cmd, {
      stdio: 'pipe',
      cwd: `/mnt/efs/${process.env.AWS_BATCH_JOB_ID}`,
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    });

    process.stdout.write(output);

    return output.toString();
  } catch (error) {
    const execError = error as ExecSyncError;

    Sentry.captureException(execError);

    if (execError.stdout) {
      process.stdout.write(execError.stdout);
      const errorStdout = execError.stdout.toString();

      throw new StepError("Unknown error - contact John if you don't understand the issue", event, {
        error: errorStdout,
      });
    }

    throw error;
  }
};
