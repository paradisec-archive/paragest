#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ParagestStack } from '../lib/paragest-stack.ts';

const app = new cdk.App();
new ParagestStack(app, 'ParagestStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
