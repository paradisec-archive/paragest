import type { Handler } from 'aws-lambda';

type Event = {
  details: {
    filename: string,
  },
};

export const handler: Handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));
  const { details: { filename } } = event;

  const match = filename.match(/(.*)-PDSC_ADMIN\./);

  return !!match;
};
