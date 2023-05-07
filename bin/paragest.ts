#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ParagestStack } from '../lib/paragest-stack';

const app = new cdk.App();
new ParagestStack(app, 'ParagestStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
