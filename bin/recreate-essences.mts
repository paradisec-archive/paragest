#!/usr/bin/env -S node --experimental-strip-types

import { readFileSync } from 'node:fs';

import { BatchClient, DescribeJobQueuesCommand, DescribeJobsCommand, SubmitJobCommand } from '@aws-sdk/client-batch';
import { confirm, select } from '@inquirer/prompts';

const ENVIRONMENTS = ['prod', 'stage'];

const JOB_DEFINITION = (env: string) => `paragest-recreate-essence-${env}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readKeys = (filename: string): string[] => {
  const contents = readFileSync(filename, 'utf-8');

  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
};

// There is a single Batch queue in the stack (construct id `BatchQueue`).
const findJobQueue = async (batch: BatchClient): Promise<string> => {
  const response = await batch.send(new DescribeJobQueuesCommand({}));

  const queue = (response.jobQueues ?? []).find((q) => q.jobQueueName?.includes('BatchQueue'));
  if (!queue?.jobQueueArn) {
    throw new Error('Could not find the Paragest Batch job queue');
  }

  return queue.jobQueueArn;
};

const waitForJob = async (batch: BatchClient, jobId: string): Promise<void> => {
  let lastStatus = '';

  for (;;) {
    const { jobs } = await batch.send(new DescribeJobsCommand({ jobs: [jobId] }));
    const job = jobs?.[0];
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status && job.status !== lastStatus) {
      lastStatus = job.status;
      console.log(`Status: ${job.status}`);
    }

    if (job.status === 'SUCCEEDED' || job.status === 'FAILED') {
      const logStream = job.container?.logStreamName;
      if (logStream) {
        console.log(`\nLogs: aws logs tail /aws/batch/job --log-stream-names '${logStream}' --profile ${process.env.AWS_PROFILE}`);
      }
      if (job.status === 'FAILED') {
        console.error(`Job failed: ${job.statusReason ?? 'unknown reason'}`);
        process.exitCode = 1;
      }
      return;
    }

    await sleep(10_000);
  }
};

const main = async () => {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: bin/recreate-essences.mts <keys-file>');
    console.error('  <keys-file> is a text file with one catalog key per line (blank lines and # comments ignored)');
    console.error('  e.g. AC1/001/AC1-001-PhotoA.jpg');
    process.exit(1);
  }

  const keys = readKeys(filename);
  if (keys.length === 0) {
    console.error(`No keys found in ${filename}`);
    process.exit(1);
  }

  const env = await select({
    message: 'Select the environment:',
    choices: ENVIRONMENTS.map((e) => ({ value: e })),
    default: 'stage',
  });
  process.env.AWS_PROFILE = `nabu-${env}`;

  const dryRun = await confirm({
    message: 'Dry run? (gather and report attributes without creating essences)',
    default: true,
  });

  console.log(`\n${dryRun ? 'DRY RUN: ' : ''}Recreating essences for ${keys.length} key(s) in ${env}:`);
  for (const key of keys) {
    console.log(`  ${key}`);
  }

  const proceed = await confirm({ message: 'Submit job?', default: true });
  if (!proceed) {
    console.log('Aborted');
    return;
  }

  const batch = new BatchClient({ region: 'ap-southeast-2' });
  const jobQueue = await findJobQueue(batch);

  const { jobId } = await batch.send(
    new SubmitJobCommand({
      jobName: 'recreate-essences',
      jobQueue,
      jobDefinition: JOB_DEFINITION(env),
      containerOverrides: {
        environment: [{ name: 'RECREATE_INPUT', value: JSON.stringify({ keys, dryRun }) }],
      },
    }),
  );

  if (!jobId) {
    throw new Error('SubmitJob did not return a job id');
  }

  console.log(`\nSubmitted job ${jobId}`);

  const watch = await confirm({ message: 'Wait for the job to finish?', default: true });
  if (watch) {
    await waitForJob(batch, jobId);
  } else {
    console.log(`Watch with: aws batch describe-jobs --jobs ${jobId} --profile ${process.env.AWS_PROFILE}`);
  }
};

main();
