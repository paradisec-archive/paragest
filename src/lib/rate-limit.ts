import { DynamoDBClient, UpdateItemCommand, type UpdateItemCommandInput } from '@aws-sdk/client-dynamodb';

const CONCURRENCY_KEY = 'pk';
const CURRENT_COUNT_ATTRIBUTE = 'currentCount';
const CONCURRENCY_LIMIT = 10;

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT;
if (!DYNAMODB_ENDPOINT) {
  throw new Error('Missing env var: DYNAMODB_ENDPOINT');
}

const CONCURRENCY_TABLE = process.env.CONCURRENCY_TABLE_NAME;
if (!CONCURRENCY_TABLE) {
  throw new Error('Missing env var: CONCURRENCY_TABLE');
}

const dbClient = new DynamoDBClient({ region: 'ap-southeast-2', endpoint: `https://${DYNAMODB_ENDPOINT}` });

// We use a DynamoDB conditional update:
//   - ConditionExpression => #count < :limit
//
// That means "Increment/Decrement currentCount by 1 only if currentCount < 10."
// If it's already >= 10, DynamoDB will throw a ConditionalCheckFailedException.

const increment = async () => {
  const incrementParams: UpdateItemCommandInput = {
    TableName: CONCURRENCY_TABLE,
    Key: {
      pk: { S: CONCURRENCY_KEY },
    },
    UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc',
    ConditionExpression: '#count < :limit',
    ExpressionAttributeNames: {
      '#count': CURRENT_COUNT_ATTRIBUTE,
    },
    ExpressionAttributeValues: {
      ':inc': { N: '1' },
      ':limit': { N: CONCURRENCY_LIMIT.toString() },
      ':zero': { N: '0' },
    },
    ReturnValues: 'UPDATED_NEW',
  };

  await dbClient.send(new UpdateItemCommand(incrementParams));
};

const decrement = async () => {
  const decrementParams: UpdateItemCommandInput = {
    TableName: CONCURRENCY_TABLE,
    Key: {
      pk: { S: CONCURRENCY_KEY },
    },
    UpdateExpression: 'ADD #count :dec',
    ConditionExpression: '#count > :zero',
    ExpressionAttributeNames: {
      '#count': CURRENT_COUNT_ATTRIBUTE,
    },
    ExpressionAttributeValues: {
      ':dec': { N: '-1' },
      ':zero': { N: '0' },
    },
    ReturnValues: 'UPDATED_NEW',
  };

  try {
    await dbClient.send(new UpdateItemCommand(decrementParams));
  } catch (releaseErr) {
    console.error('Failed to decrement concurrency counter', releaseErr);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_RETRIES = 5;
const BASE_DELAY = 100; // Start with 100ms delay

// biome-ignore lint/suspicious/noExplicitAny: We don't care what we get
type AnyFunction = (...args: any[]) => Promise<any>;

export const throttle =
  <T extends AnyFunction>(func: T) =>
  async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    let retries = 0;

    while (true) {
      try {
        await increment();

        break;
      } catch (err: unknown) {
        console.error('Failed to increment concurrency counter', err);
        const error = err as Error;
        if (error.name !== 'ConditionalCheckFailedException') {
          throw err;
        }

        if (retries >= MAX_RETRIES) {
          throw new Error('Too many retries');
        }

        const delay = BASE_DELAY * 2 ** retries;
        const jitter = Math.random() * 100;
        console.log(`Retrying in ${delay + jitter}ms`);
        await sleep(delay + jitter);

        retries += 1;
      }
    }

    try {
      const response = await func(...args);

      return response;
    } finally {
      decrement();
    }
  };
