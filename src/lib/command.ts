import { execSync } from 'node:child_process';

import * as Sentry from '@sentry/node';

import { StepError } from './errors.js';

interface ExecSyncError extends Error {
  stdout?: Buffer;
}

export const execute = (command: string, event: Record<string, string | number | object | undefined>) => {
  try {
    const cmd = `${command} 2>&1`;

    const output = execSync(cmd, { stdio: 'pipe', cwd: '/tmp' });

    process.stdout.write(output);

    // const outputString = output.toString();
    // console.debug('Captured stdout:', outputString);
  } catch (error) {
    const execError = error as ExecSyncError;

    Sentry.captureException(execError);

    if (execError.stdout) {
      process.stdout.write(execError.stdout);
      const errorStdout = execError.stdout.toString();

      throw new StepError("Unknown error - contact John if you don't understand the issue", event, { error: errorStdout });
    }
  }
};
