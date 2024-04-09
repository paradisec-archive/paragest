import * as Sentry from '@sentry/serverless';

// import { ProfilingIntegration } from '@sentry/profiling-node';

// import { RewriteFrames } from '@sentry/integrations';

// import type { StackFrame } from '@sentry/types';

// const transformStacktrace = (frame: StackFrame) => {
//   if (!frame.filename) return frame;
//
//   if (!frame.filename.startsWith('/')) return frame;
//
//   if (frame.filename.includes('/node_modules/')) return frame;
//
//   if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return frame;
//
//   const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME.replace(/^(.+)-[^-]+$/g, '$1');
//
//   frame.filename = frame.filename.replace('/var/task', `/var/task/src/lambda/${functionName}/src`).replace(/\.js$/, '.ts'); // eslint-disable-line no-param-reassign
//
//   return frame;
// };

if (!process.env.SENTRY_DSN) {
  throw new Error('Missing SENTRY_DSN');
}

if (!process.env.PARAGEST_ENV) {
  throw new Error('Missing PARAGEST_ENV');
}

Sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.PARAGEST_ENV,
  integrations: [
    // new ProfilingIntegration(),
  //   new RewriteFrames({
  //     iteratee: transformStacktrace,
  //   }),
  ],
  // Performance Monitoring
  tracesSampleRate: 1.0,
  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 1.0,
  beforeSend: (event, hint) => {
    const error = hint?.originalException;
    if (error instanceof Error && error.name === 'StepError') {
      // Ignore StepErrors as they are expected
      return null;
    }

    return event;
  },
});
