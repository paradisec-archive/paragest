import { BatchClient, DeregisterJobDefinitionCommand, paginateDescribeJobDefinitions } from '@aws-sdk/client-batch';
import { DescribeStateMachineCommand, DescribeStateMachineForExecutionCommand, paginateListExecutions, SFNClient } from '@aws-sdk/client-sfn';
import * as Sentry from '@sentry/aws-serverless';
import type { Handler } from 'aws-lambda';

import '../lib/sentry.js';

import { jobDefinitionArnsIn, parseJobDefinitionArn, supersededRevisions } from '../lib/job-definition-revisions.js';

const stateMachineArn = process.env.STATE_MACHINE_ARN;
if (!stateMachineArn) {
  throw new Error('STATE_MACHINE_ARN must be defined');
}

const batch = new BatchClient();
const sfn = new SFNClient();

const currentJobDefinitionArns = async () => {
  const { definition } = await sfn.send(new DescribeStateMachineCommand({ stateMachineArn }));

  return jobDefinitionArnsIn(definition ?? '');
};

// An execution keeps the definition it started with, so one that predates a deploy may
// still submit a revision that is no longer current
const inUseJobDefinitionArns = async () => {
  const arns = new Set<string>();
  for await (const page of paginateListExecutions({ client: sfn }, { stateMachineArn, statusFilter: 'RUNNING' })) {
    for (const { executionArn } of page.executions ?? []) {
      const { definition } = await sfn.send(new DescribeStateMachineForExecutionCommand({ executionArn }));
      for (const arn of jobDefinitionArnsIn(definition ?? '')) {
        arns.add(arn);
      }
    }
  }

  return [...arns];
};

const activeRevisions = async (jobDefinitionName: string) => {
  const revisions = [];
  for await (const page of paginateDescribeJobDefinitions({ client: batch }, { jobDefinitionName, status: 'ACTIVE' })) {
    for (const { jobDefinitionArn, revision } of page.jobDefinitions ?? []) {
      if (jobDefinitionArn && revision !== undefined) {
        revisions.push({ jobDefinitionArn, jobDefinitionName, revision });
      }
    }
  }

  return revisions;
};

export const handler: Handler = Sentry.wrapHandler(async () => {
  const currentArns = await currentJobDefinitionArns();
  const inUseArns = await inUseJobDefinitionArns();
  const names = [...new Set(currentArns.map((arn) => parseJobDefinitionArn(arn).name))];
  const active = (await Promise.all(names.map(activeRevisions))).flat();

  const superseded = supersededRevisions(currentArns, active, inUseArns);
  console.log(`Deregistering ${superseded.length} superseded job definition revisions`);

  for (const jobDefinition of superseded) {
    console.log(`Deregistering ${jobDefinition}`);
    await batch.send(new DeregisterJobDefinitionCommand({ jobDefinition }));
  }
});
