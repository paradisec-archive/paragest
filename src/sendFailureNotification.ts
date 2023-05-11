import type { Handler } from 'aws-lambda';

type Event = {
  Cause: string,
}
type ErrorData = {
  message: string,
  principalId: string
  data: Record<string, string>,
};

export const handler: Handler = async (event: Event) => {
  console.debug('Error:', JSON.stringify(event, null, 2));

  const { Cause } = event;
  const { errorMessage } = JSON.parse(Cause);
  const { message, principalId, data } = JSON.parse(errorMessage) as ErrorData;
  console.debug({ message, principalId, data });

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
};
