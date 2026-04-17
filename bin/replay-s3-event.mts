#!/usr/bin/env -S node --experimental-strip-types

import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { GetExecutionHistoryCommand, ListExecutionsCommand, ListStateMachinesCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { v4 as uuidv4 } from 'uuid';

const ENVIRONMENTS = ['prod', 'stage'];
const PATHS = ['incoming', 'rejected', 'damsmart'];

const principalIdPrefix = process.env.PRINCIPAL_ID_PREFIX;
if (!principalIdPrefix) {
  throw new Error('PRINCIPAL_ID_PREFIX environment variable is required');
}

const normalisePrincipalId = (value: string) => (value.startsWith(principalIdPrefix) ? value : `${principalIdPrefix}${value}`);

const lambda = new LambdaClient({ region: 'ap-southeast-2' });
const sfn = new SFNClient({ region: 'ap-southeast-2', maxAttempts: 10, retryMode: 'adaptive' });

// Cache for file inputs to avoid repeated SFN API calls
type FileInput = {
  id: string;
  bucketName: string;
  objectKey: string;
  objectSize: number;
  principalId: string;
  notes: string[];
};

// Global cache that will store execution inputs for each file
const executionInputCache: Map<string, FileInput> = new Map();

// Principal id reused within a collection (first '-'-separated segment of the key)
const principalIdByCollection: Map<string, string> = new Map();

const collectionFromKey = (key: string) => key.split('-')[0];

let nextExecutionToken: string | undefined;
let pagesFetched = 0;
let paginationExhausted = false;
const MAX_PAGES = 10;

let paragestStateMachineArn: string | undefined;
const findParagestStateMachine = async () => {
  if (paragestStateMachineArn) return paragestStateMachineArn;

  const stateMachineResponse = await sfn.send(new ListStateMachinesCommand({}));
  const stateMachine = stateMachineResponse.stateMachines?.find((sm) => sm.name === 'Paragest');

  if (!stateMachine?.stateMachineArn) {
    throw new Error('Could not find Paragest state machine');
  }

  paragestStateMachineArn = stateMachine.stateMachineArn;
  return paragestStateMachineArn;
};

const buildExecutionCache = async () => {
  if (paginationExhausted) {
    return;
  }

  if (pagesFetched >= MAX_PAGES) {
    console.log(`Reached maximum pages (${MAX_PAGES}), giving up on further cache building`);
    return;
  }

  pagesFetched++;

  console.log(`Building execution cache from Step Function executions (page ${pagesFetched})...`);
  const stateMachineArn = await findParagestStateMachine();

  const listResponse = await sfn.send(
    new ListExecutionsCommand({
      stateMachineArn,
      statusFilter: 'FAILED',
      maxResults: 50,
      nextToken: nextExecutionToken,
    }),
  );

  nextExecutionToken = listResponse.nextToken;
  if (!nextExecutionToken) {
    paginationExhausted = true;
  }

  if (!listResponse.executions || listResponse.executions.length === 0) {
    console.warn('No executions found in Step Function history');
    return;
  }

  // Process each execution and build the cache
  let processedCount = 0;
  for (const execution of listResponse.executions) {
    try {
      const historyResponse = await sfn.send(
        new GetExecutionHistoryCommand({
          executionArn: execution.executionArn,
          includeExecutionData: true,
          maxResults: 1,
        }),
      );

      // Find the execution started event which contains the input
      const startedEvent = historyResponse.events?.find((event) => event.type === 'ExecutionStarted' && event.executionStartedEventDetails?.input);

      if (!startedEvent?.executionStartedEventDetails?.input) {
        continue;
      }

      const rawInput = JSON.parse(startedEvent.executionStartedEventDetails.input) as Partial<FileInput> & Omit<FileInput, 'notes'>;
      const fileInput: FileInput = {
        ...rawInput,
        principalId: normalisePrincipalId(rawInput.principalId),
        notes: rawInput.notes ?? [],
      };

      if (fileInput.objectKey.startsWith('incoming/') || fileInput.objectKey.startsWith('damsmart/')) {
        const key = fileInput.objectKey.replace(/(incoming|damsmart)\//, '');
        executionInputCache.set(key, fileInput);
        principalIdByCollection.set(collectionFromKey(key), fileInput.principalId);
        processedCount++;
      }
    } catch (err) {
      const error = err as Error;
      // Skip this execution if there's an error
      console.warn(`Error processing execution ${execution.executionArn}: ${error.message}`);
    }
  }

  console.log(`Cached inputs for ${processedCount} files (total pages fetched: ${pagesFetched})`);
};

const findOriginalInput = async (key: string): Promise<FileInput | undefined> => {
  const cached = executionInputCache.get(key);
  if (cached) return cached;

  if (paginationExhausted) {
    console.log(`Could not find execution for ${key} (pagination exhausted after ${pagesFetched} pages).`);
    return undefined;
  }

  if (pagesFetched >= MAX_PAGES) {
    console.log(`Could not find execution for ${key} (reached max ${MAX_PAGES} pages).`);
    return undefined;
  }

  console.log(`Cache miss for ${key}, fetching next page of executions...`);
  await buildExecutionCache();
  return findOriginalInput(key);
};

const moveFileToIncoming = async (bucketName: string, path: string, key: string, size: number) => {
  if (path === 'incoming' || path === 'damsmart') {
    console.log('File is already in incoming, no need to move');
    return;
  }

  console.log(`Moving file from ${path}/${key} to incoming/${key}`);

  // For large files (>5GB), we need to use multipart copy
  if (size > 5 * 1024 * 1024 * 1024) {
    // For simplicity in this script, we're just warning about large files
    console.warn(`File is larger than 5GB (${size} bytes). You should use the AWS CLI to copy this file with tags:`);
    console.warn(
      `aws s3api put-object-tagging --bucket ${bucketName} --key ${path}/${key} --tagging 'TagSet=[{Key=manual,Value=true}]' --profile ${process.env.AWS_PROFILE}`,
    );
    console.warn(`aws s3 cp s3://${bucketName}/${path}/${key} s3://${bucketName}/incoming/${key} --profile ${process.env.AWS_PROFILE}`);

    const shouldContinue = await confirm({
      message: 'Do you want to continue without moving the file?',
      default: false,
    });

    if (!shouldContinue) {
      console.log('Exiting as requested');
      process.exit(0);
    }

    console.log('Continuing without moving the file. The Lambda will be invoked with the file in its current location.');
    return;
  }

  // Copy the object to incoming/ with the manual tag in a single operation
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${path}/${key}`,
      Key: `incoming/${key}`,
      Tagging: 'manual=true', // Set the tag during copy to avoid race conditions
      TaggingDirective: 'REPLACE',
    }),
  );

  console.log(`Successfully copied ${path}/${key} to incoming/${key} with manual=true tag`);

  // Format the date for the rejected archive folder
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const rejectedArchiveKey = `rejected-${date}/${key}`;

  // First copy to the rejected-$date folder
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${path}/${key}`,
        Key: rejectedArchiveKey,
      }),
    );

    console.log(`Successfully copied ${path}/${key} to ${rejectedArchiveKey}`);

    // Now delete the original file
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: `${path}/${key}`,
      }),
    );

    console.log(`Successfully deleted original file ${path}/${key}`);
  } catch (err) {
    const error = err as Error;
    console.error(`Failed to archive and delete file: ${error.message}`);
    throw error;
  }
};

const invokeLambdaWithS3Event = async (bucketName: string, path: string, key: string, size: number) => {
  // First, move the file to incoming if it's in rejected
  if (path === 'rejected') {
    await moveFileToIncoming(bucketName, path, key, size);
  }

  const listFunctionsCommand = new ListFunctionsCommand({});
  const listResponse = await lambda.send(listFunctionsCommand);

  const funcName = listResponse.Functions?.find((func) => func.FunctionName?.startsWith('ParagestStack-ProcessS3EventLambda'))?.FunctionName;

  if (!funcName) {
    console.error('Could not find the ProcessS3EventLambda function');
    process.exit(1);
  }

  const cached = await findOriginalInput(key);

  let fileInput: FileInput;
  if (cached) {
    if (cached.objectSize !== size) {
      throw new Error(`Size mismatch: ${cached.objectSize} (original) !== ${size} (current).`);
    }
    const replayNote = `replayS3Event: ${cached.objectKey} replayed by ${cached.principalId} with size ${size}`;
    fileInput = { ...cached, id: uuidv4(), notes: [replayNote, ...cached.notes] };
  } else {
    const collection = collectionFromKey(key);
    let principalId = principalIdByCollection.get(collection);
    if (principalId) {
      console.log(`Reusing cached principalId ${principalId} for collection ${collection}`);
    } else {
      const entered = (
        await input({
          message: `No cached execution for ${key} (collection ${collection}). Enter principalId (will be prefixed with ${principalIdPrefix} if needed):`,
          validate: (value) => value.trim().length > 0 || 'principalId cannot be empty',
        })
      ).trim();
      principalId = normalisePrincipalId(entered);
      principalIdByCollection.set(collection, principalId);
    }
    const objectKey = path === 'damsmart' ? `damsmart/${key}` : `incoming/${key}`;
    fileInput = {
      id: uuidv4(),
      bucketName,
      objectKey,
      objectSize: size,
      principalId,
      notes: [`replayS3Event: ${objectKey} replayed by ${principalId} with size ${size} (synthesised input)`],
    };
  }

  const stateMachineArn = await findParagestStateMachine();

  const executionCommand = new StartExecutionCommand({
    stateMachineArn,
    input: JSON.stringify(fileInput),
  });
  await sfn.send(executionCommand);

  console.log('Successfully invoked Step function');
};

const s3 = new S3Client({ region: 'ap-southeast-2' });

const promptForEnvironment = async (): Promise<string> => {
  return select({
    message: 'Select the environment:',
    choices: ENVIRONMENTS.map((env) => ({ value: env })),
    default: 'prod',
  });
};

const promptForPath = async (): Promise<string> => {
  return select({
    message: 'Select the path:',
    choices: PATHS.map((p) => ({ value: p })),
  });
};

const listFiles = async (s3Client: S3Client, bucket: string, prefix: string) => {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${prefix}/`,
    MaxKeys: 500,
  });

  const response = await s3Client.send(command);

  return (response.Contents ?? [])
    .map((item) => item.Key)
    .filter(Boolean)
    .filter((key) => key !== `${prefix}/` && !key.endsWith('/') && !key.endsWith('/.keep'))
    .map((key) => key.replace(`${prefix}/`, ''))
    .sort((a, b) => a.localeCompare(b));
};

const promptForFiles = async (files: string[]): Promise<string[]> => {
  const selectedFiles = await checkbox({
    message: 'Select file(s) to process:',
    choices: files.map((f) => ({ value: f })),
    pageSize: 15,
  });

  if (!selectedFiles.length) {
    console.log('No files selected, please select at least one file.');

    return promptForFiles(files);
  }

  return selectedFiles;
};

const processFiles = async (env: string, path: string) => {
  const bucketName = `paragest-ingest-${env}`;
  console.log(`Fetching files from ${bucketName}/${path}/...`);

  const files = await listFiles(s3, bucketName, path);

  if (files.length === 0) {
    console.log(`No files to process in ${bucketName}/${path}/`);
    return true;
  }

  const keys = await promptForFiles(files);

  console.log(`Using environment: ${env}`);
  console.log(`Using path: ${path}`);
  console.log(`Selected ${keys.length} file(s)`);

  let successCount = 0;
  let failCount = 0;

  for (const key of keys) {
    console.log(`Processing file: ${key}`);

    // Get object size from S3
    const headObjectCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: `${path}/${key}`,
    });

    try {
      const objectInfo = await s3.send(headObjectCommand);
      const size = objectInfo.ContentLength;

      if (!size) {
        console.error('Key not found or size is 0');
        failCount++;
        continue;
      }

      await invokeLambdaWithS3Event(bucketName, path, key, size);
      successCount++;
    } catch (err) {
      const error = err as Error;
      console.error(`Error processing file ${key}: ${error.message}`);
      failCount++;
    }
  }

  console.log(`Processing complete. Success: ${successCount}, Failed: ${failCount}`);
  return successCount > 0;
};

const promptToContinue = async (): Promise<boolean> => {
  return confirm({
    message: 'Do you want to process more files?',
    default: true,
  });
};

const main = async () => {
  const env = await promptForEnvironment();
  process.env.AWS_PROFILE = `nabu-${env}`;

  // Build the cache once at the start to improve performance
  console.log('Initializing...');
  await buildExecutionCache();

  let continueProcessing = true;

  while (continueProcessing) {
    const path = await promptForPath();
    const success = await processFiles(env, path);

    if (success) {
      continueProcessing = await promptToContinue();
    } else {
      console.log('There was an error processing all files.');
      continueProcessing = await promptToContinue();
    }
  }

  console.log('Exiting...');
};

main();
