import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SecretValue } from 'aws-cdk-lib';

export class ParagestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.env?.account === '618916419351' ? 'prod' : 'stage';

    const bucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
    });

    const startState = new sfn.Pass(this, 'StartState');
    const successState = new sfn.Succeed(this, 'SuccessState');
    const failureState = new sfn.Fail(this, 'FailureState');
    // const choice = new sfn.Choice(this, 'Did it work?');

    const checkCatalogForItem = new nodejs.NodejsFunction(this, 'CheckCatalogForItemLambda', {
      entry: 'src/checkCatalogForItem.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
    });
    const checkCatalogForItemTask = new tasks.LambdaInvoke(this, 'CheckDBForItemTask', {
      lambdaFunction: checkCatalogForItem,
    });

    const nabuOauthSecret = new secretsmanager.Secret(this, 'NabuOAuthSecret', {
      description: 'OAuth credentials for Nabu',
      secretName: '/paragest/nabu/oauth',
      secretObjectValue: {
        clientId: SecretValue.unsafePlainText('FIXME'),
        clientSecret: SecretValue.unsafePlainText('FIXME'),
      },
    });
    nabuOauthSecret.grantRead(checkCatalogForItem);

    const sendFailureNotification = new nodejs.NodejsFunction(this, 'SendFailureNotificationLambda', {
      entry: 'src/sendFailureNotification.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
    });
    const sendFailureNotificationTask = new tasks.LambdaInvoke(this, 'sendFailureNotificationTask', {
      lambdaFunction: sendFailureNotification,
    });

    const parallel = new sfn.Parallel(this, 'ParallelErrorCatcher');

    const workflow = sfn.Chain
      .start(checkCatalogForItemTask);
    parallel.branch(workflow);

    const failure = sfn.Chain
      .start(sendFailureNotificationTask)
      .next(failureState);
    parallel.addCatch(failure);

    const definition = sfn.Chain
      .start(startState)
      .next(parallel)
      .next(successState);

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineName: 'Paragest',
      timeout: cdk.Duration.hours(1), // TODO: Set a reasonable timeout once we know more
    });

    const processS3Event = new nodejs.NodejsFunction(this, 'ProcessS3EventLambda', {
      entry: 'src/processS3Event.ts',
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
      runtime: lambda.Runtime.NODEJS_18_X,
    });

    const s3EventSource = new eventsources.S3EventSource(bucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'incoming/' }],
    });
    processS3Event.addEventSource(s3EventSource);

    stateMachine.grantStartExecution(processS3Event);
  }
}
