import { SFNClient, SendTaskFailureCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient();

export const processBatch = async <Event>(handler: (event: Event) => Promise<Event>) => {
  const event = process.env.SFN_INPUT;
  if (!event) {
    throw new Error('No event provided');
  }

  try {
    const newEvent = await handler(JSON.parse(event));

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
