#!/usr/bin/env -S node --experimental-strip-types

import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { GetExecutionHistoryCommand, ListExecutionsCommand, ListStateMachinesCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import inquirer from 'inquirer';
import { v4 as uuidv4 } from 'uuid';

const ENVIRONMENTS = ['prod', 'stage'];
const PATHS = ['incoming', 'rejected'];

const lambda = new LambdaClient({ region: 'ap-southeast-2' });
const sfn = new SFNClient({ region: 'ap-southeast-2' });

// Cache for file inputs to avoid repeated SFN API calls
type FileInput = {
  id: string;
  bucketName: string;
  objectKey: string;
  objectSize: number;
  principalId: string;
};

// Global cache that will store execution inputs for each file
const executionInputCache: Map<string, FileInput> = new Map();

// Global variable to store the nextToken for pagination
let nextExecutionToken: string | undefined;

// Track pagination attempts
let paginationAttempts = 0;
const MAX_PAGINATION_ATTEMPTS = 10;

// Find the state machine ARN for Paragest
const findParagestStateMachine = async () => {
  const listStateMachinesCommand = new ListStateMachinesCommand({});
  const stateMachineResponse = await sfn.send(listStateMachinesCommand);

  const stateMachine = stateMachineResponse.stateMachines?.find((sm) => sm.name === 'Paragest');

  if (!stateMachine?.stateMachineArn) {
    throw new Error('Could not find Paragest state machine');
  }

  return stateMachine.stateMachineArn;
};

// Initialize or extend the cache by fetching executions page by page
const buildExecutionCache = async () => {
  // Reset pagination attempts if we're starting a new pagination sequence
  if (!nextExecutionToken) {
    paginationAttempts = 0;
  }

  // Give up after MAX_PAGINATION_ATTEMPTS
  if (paginationAttempts >= MAX_PAGINATION_ATTEMPTS) {
    console.log(`Reached maximum pagination attempts (${MAX_PAGINATION_ATTEMPTS}), giving up on further cache building`);
    return;
  }

  paginationAttempts++;

  console.log(`Building execution cache from Step Function executions (page ${paginationAttempts})...`);
  const stateMachineArn = await findParagestStateMachine();

  // Get executions for the Paragest state machine
  const listResponse = await sfn.send(
    new ListExecutionsCommand({
      stateMachineArn,
      statusFilter: 'FAILED',
      maxResults: 50,
      nextToken: nextExecutionToken,
    }),
  );

  // Store the next token for pagination
  nextExecutionToken = listResponse.nextToken;

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

      const input = JSON.parse(startedEvent.executionStartedEventDetails.input) as FileInput;

      // Extract the key from the objectKey (remove 'incoming/')
      if (input.objectKey.startsWith('incoming/')) {
        const key = input.objectKey.replace('incoming/', '');
        executionInputCache.set(key, input);
        processedCount++;
      }
    } catch (err) {
      const error = err as Error;
      // Skip this execution if there's an error
      console.warn(`Error processing execution ${execution.executionArn}: ${error.message}`);
    }
  }

  console.log(`Cached inputs for ${processedCount} files (total pages fetched: ${paginationAttempts})`);
};

const findOriginalInput = async (key: string) => {
  // Check if the input is already in our cache
  if (executionInputCache.has(key)) {
    const cachedInput = executionInputCache.get(key);
    return cachedInput;
  }

  if (paginationAttempts >= MAX_PAGINATION_ATTEMPTS) {
    console.log(`Could not find execution for ${key} after ${paginationAttempts} pages.`);
    return;
  }

  // If not in cache, try to fetch the next page of executions
  console.log(`Cache miss for ${key}, fetching next page of executions...`);

  // Try to extend the cache with the next page of data
  await buildExecutionCache();

  return findOriginalInput(key);
};

const moveFileToIncoming = async (bucketName: string, path: string, key: string, size: number) => {
  if (path === 'incoming') {
    console.log('File is already in incoming, no need to move');
    return;
  }

  console.log(`Moving file from ${path}/${key} to incoming/${key}`);

  // For large files (>5GB), we need to use multipart copy
  if (size > 5 * 1024 * 1024 * 1024) {
    // For simplicity in this script, we're just warning about large files
    console.warn(`File is larger than 5GB (${size} bytes). You should use the AWS CLI to copy this file with tags:`);
    console.warn(`aws s3 cp s3://${bucketName}/${path}/${key} s3://${bucketName}/incoming/${key} --tagging "manual=true" --profile ${process.env.AWS_PROFILE}`);

    const shouldContinue = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Do you want to continue without moving the file?',
        default: false,
      },
    ]);

    if (!shouldContinue.continue) {
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

  const input = await findOriginalInput(key);
  if (!input) {
    console.log(`No input found for ${key}`);
    return;
  }

  if (input.objectSize !== size) {
    throw new Error(`Size mismatch: ${input.objectSize} (original) !== ${size} (current).`);
  }

  // TODO: Reset the id so it can't use any old inputs
  input.id = uuidv4();

  // Get the state machine ARN
  const stateMachineArn = await findParagestStateMachine();

  // Create event payload - always use incoming path for key
  const s3Key = `incoming/${key}`;
  console.log(`Using S3 key: ${s3Key}`);

  const executionCommand = new StartExecutionCommand({
    stateMachineArn,
    input: JSON.stringify(input),
  });
  await sfn.send(executionCommand);

  console.log('Successfully invoked Step function');
};

const s3 = new S3Client({ region: 'ap-southeast-2' });

const promptForEnvironment = async (): Promise<string> => {
  const { environment } = await inquirer.prompt([
    {
      type: 'list',
      name: 'environment',
      message: 'Select the environment:',
      choices: ENVIRONMENTS,
      default: 'prod',
    },
  ]);

  return environment;
};

const promptForPath = async (): Promise<string> => {
  const { path } = await inquirer.prompt([
    {
      type: 'list',
      name: 'path',
      message: 'Select the path:',
      choices: PATHS,
      default: 'incoming',
    },
  ]);

  return path;
};

const listFiles = async (s3Client: S3Client, bucket: string, prefix: string) => {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${prefix}/`,
    MaxKeys: 500,
  });

  const response = await s3Client.send(command);

  if (!response.Contents || response.Contents.length === 0) {
    throw new Error(`No files found in ${bucket}/${prefix}/`);
  }

  return response.Contents.map((item) => item.Key)
    .filter(Boolean)
    .filter((key) => key !== `${prefix}/` && !key.endsWith('/') && !key.endsWith('/.keep'))
    .map((key) => key.replace(`${prefix}/`, ''))
    .sort((a, b) => a.localeCompare(b));
};

const promptForFiles = async (files: string[]): Promise<string[]> => {
  const { selectedFiles } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedFiles',
      message: 'Select file(s) to process:',
      choices: files,
      pageSize: 15,
    },
  ]);

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
  const { continueProcessing } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continueProcessing',
      message: 'Do you want to process more files?',
      default: true,
    },
  ]);

  return continueProcessing;
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
