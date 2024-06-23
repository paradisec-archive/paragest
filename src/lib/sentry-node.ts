import * as Sentry from '@sentry/node';

if (!process.env.SENTRY_DSN) {
  throw new Error('Missing SENTRY_DSN');
}

if (!process.env.PARAGEST_ENV) {
  throw new Error('Missing PARAGEST_ENV');
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.PARAGEST_ENV,
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
