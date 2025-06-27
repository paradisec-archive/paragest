#!/usr/bin/env -S node --experimental-strip-types

import { GetExecutionHistoryCommand, ListExecutionsCommand, ListStateMachinesCommand, SFNClient } from '@aws-sdk/client-sfn';
import inquirer from 'inquirer';

const ENVIRONMENTS = ['prod', 'stage'];

// Create a date one week ago
const oneWeekAgo = new Date();
oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

// Function to find the Paragest state machine ARN
const findParagestStateMachine = async (sfn: SFNClient) => {
  const listStateMachinesCommand = new ListStateMachinesCommand({});
  const stateMachineResponse = await sfn.send(listStateMachinesCommand);

  const stateMachine = stateMachineResponse.stateMachines?.find((sm) => sm.name === 'Paragest');

  if (!stateMachine?.stateMachineArn) {
    throw new Error('Could not find Paragest state machine');
  }

  return stateMachine.stateMachineArn;
};

// Main function to list failures
const listFailures = async (env: string) => {
  console.log(`Using environment: ${env}`);
  process.env.AWS_PROFILE = `nabu-${env}`;

  const sfn = new SFNClient({ region: 'ap-southeast-2' });
  const stateMachineArn = await findParagestStateMachine(sfn);

  console.log('Fetching the last 100 failed executions from the past week...');

  // Get failed executions for the Paragest state machine
  const listResponse = await sfn.send(
    new ListExecutionsCommand({
      stateMachineArn,
      statusFilter: 'FAILED',
      maxResults: 1000,
    }),
  );

  if (!listResponse.executions || listResponse.executions.length === 0) {
    console.log('No failed executions found in the past week.');
    return;
  }

  // Filter executions that are within the past week
  const recentFailures = listResponse.executions.filter((execution) => execution.startDate && execution.startDate >= oneWeekAgo);

  if (recentFailures.length === 0) {
    console.log('No failed executions found in the past week.');
    return;
  }

  console.log(`Found ${recentFailures.length} failed executions in the past week.`);
  console.log('\nAnalyzing failure details...');

  // Array to store failure details
  const failureDetails = [];

  // Cache for file inputs to avoid repeated SFN API calls
  type FileInput = {
    bucketName: string;
    objectKey: string;
    objectSize: number;
    principalId: string;
  };

  // Process each failure and extract details
  for (const execution of recentFailures) {
    try {
      // Get the execution history to find both the input and the failure cause
      const historyResponse = await sfn.send(
        new GetExecutionHistoryCommand({
          executionArn: execution.executionArn,
          includeExecutionData: true,
        }),
      );

      // Find the execution started event which contains the input
      const startedEvent = historyResponse.events?.find((event) => event.type === 'ExecutionStarted' && event.executionStartedEventDetails?.input);

      // Find the execution failed event which contains the error and cause
      const failedEvent = historyResponse.events?.find((event) => event.type === 'TaskFailed' && event.taskFailedEventDetails);

      if (!startedEvent?.executionStartedEventDetails?.input || !failedEvent?.taskFailedEventDetails) {
        console.warn(`Could not find complete information for execution: ${execution.executionArn}`);
        continue;
      }

      // Parse the input to get the objectKey
      const input = JSON.parse(startedEvent.executionStartedEventDetails.input) as FileInput;
      const objectKey = input.objectKey;

      // Extract error information
      const errorName = failedEvent.taskFailedEventDetails.error || 'Unknown error';
      const errorCause = failedEvent.taskFailedEventDetails.cause || 'Unknown cause';

      // Extract details from the cause if it's JSON
      let errorMessage = errorCause;
      try {
        const causeObj = JSON.parse(errorCause) as { errorMessage: string };
        errorMessage = causeObj.errorMessage || errorCause;
      } catch {
        // If cause is not valid JSON, use it directly
      }

      // Add to our results array
      failureDetails.push({
        objectKey,
        startDate: execution.startDate?.toISOString(),
        stopDate: execution.stopDate?.toISOString(),
        error: errorName,
        cause: errorMessage,
      });
    } catch (err) {
      const error = err as Error;
      console.warn(`Error processing execution ${execution.executionArn}: ${error.message}`);
    }
  }

  // Format the data for display
  const displayData = failureDetails.map((failure) => ({
    'Object Key': failure.objectKey,
    'Failure Time': failure.stopDate ? new Date(failure.stopDate).toLocaleString() : 'Unknown',
    'Error Type': failure.error,
    'Error Cause': failure.cause.substring(0, 100) + (failure.cause.length > 100 ? '...' : ''),
  }));

  // Print out the results using console.table
  console.log('\nRECENT STEP FUNCTION FAILURES:');
  console.table(displayData);
  console.log(`Total failures: ${failureDetails.length}`);
};

// Main execution
const main = async () => {
  try {
    const { environment } = await inquirer.prompt([
      {
        type: 'list',
        name: 'environment',
        message: 'Select the environment:',
        choices: ENVIRONMENTS,
        default: 'stage',
      },
    ]);

    await listFailures(environment);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
