import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient } from '@aws-sdk/client-sfn';

const sfn = new SFNClient();

export const processBatch = async <Event>(handler: (event: Event) => Promise<Event>) => {
  const rawEvent = process.env.SFN_INPUT;
  if (!rawEvent) {
    throw new Error('No event provided');
  }

  const event = JSON.parse(rawEvent);

  process.env.SFN_ID = event.id;

  try {
    const newEvent = await handler(event);

    const successCommand = new SendTaskSuccessCommand({
      taskToken: process.env.SFN_TASK_TOKEN,
      output: JSON.stringify(newEvent),
    });
    await sfn.send(successCommand);
  } catch (error) {
    console.error('Error:', error);
    const err = error as Error;
    const failureCommand = new SendTaskFailureCommand({
      taskToken: process.env.SFN_TASK_TOKEN,
      error: err.name,
      cause: JSON.stringify({ errorType: err.name, errorMessage: err.message }),
    });
    await sfn.send(failureCommand);
  }
};
