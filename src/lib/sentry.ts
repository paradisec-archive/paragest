import * as Sentry from '@sentry/aws-serverless';

if (!process.env.SENTRY_DSN) {
  throw new Error('Missing SENTRY_DSN');
}

if (!process.env.SENTRY_RELEASE) {
  throw new Error('Missing SENTRY_RELEASE');
}

if (!process.env.PARAGEST_ENV) {
  throw new Error('Missing PARAGEST_ENV');
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.PARAGEST_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: 1.0,
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
