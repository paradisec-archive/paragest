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

// TODO: Be more specific on where functions can read and write

export class ParagestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.env?.account === '618916419351' ? 'prod' : 'stage';

    const lambdaCommon: nodejs.NodejsFunctionProps = {
      environment: {
        PARAGEST_ENV: env,
      },
      runtime: lambda.Runtime.NODEJS_18_X,
    };

    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
    });
    const catalogBucket = s3.Bucket.fromBucketName(this, 'CatalogBucket', `nabu-catalog-${env}`);

    const startState = new sfn.Pass(this, 'StartState');
    const successState = new sfn.Succeed(this, 'SuccessState');
    const failureState = new sfn.Fail(this, 'FailureState');
    // const choice = new sfn.Choice(this, 'Did it work?');

    const rejectEmptyFiles = new nodejs.NodejsFunction(this, 'RejectEmptyFilesLambda', {
      ...lambdaCommon,
      entry: 'src/rejectEmptyFiles.ts',
    });
    const rejectEmptyFilesTask = new tasks.LambdaInvoke(this, 'rejectEmptyFilesTask', {
      lambdaFunction: rejectEmptyFiles,
      resultPath: sfn.JsonPath.DISCARD,
    });

    const checkCatalogForItem = new nodejs.NodejsFunction(this, 'CheckCatalogForItemLambda', {
      ...lambdaCommon,
      entry: 'src/checkCatalogForItem.ts',
    });
    const checkCatalogForItemTask = new tasks.LambdaInvoke(this, 'CheckDBForItemTask', {
      lambdaFunction: checkCatalogForItem,
      resultPath: sfn.JsonPath.stringAt('$.details'),
      resultSelector: {
        collectionIdentifier: sfn.JsonPath.stringAt('$.Payload.collectionIdentifier'),
        itemIdentifier: sfn.JsonPath.stringAt('$.Payload.itemIdentifier'),
        filename: sfn.JsonPath.stringAt('$.Payload.filename'),
        extension: sfn.JsonPath.stringAt('$.Payload.extension'),
      },
    });

    const checkIfPDSC = new nodejs.NodejsFunction(this, 'CheckIfPDSCLambda', {
      ...lambdaCommon,
      entry: 'src/checkIfPDSC.ts',
    });
    const checkIfPDSCTask = new tasks.LambdaInvoke(this, 'CheckIfPDSCTask', {
      lambdaFunction: checkIfPDSC,
      resultPath: sfn.JsonPath.stringAt('$.pdscCheck'),
      resultSelector: {
        isPDSCFile: sfn.JsonPath.stringAt('$.Payload'),
      },
    });

    const addToCatalog = new nodejs.NodejsFunction(this, 'AddToCatalogLambda', {
      ...lambdaCommon,
      entry: 'src/addToCatalog.ts',
    });
    ingestBucket.grantRead(addToCatalog);
    ingestBucket.grantDelete(addToCatalog);
    catalogBucket.grantPut(addToCatalog);

    const addToCatalogTask = new tasks.LambdaInvoke(this, 'AddToCatalogTask', {
      lambdaFunction: addToCatalog,
      resultPath: sfn.JsonPath.DISCARD,
    });

    const importMetadata = new nodejs.NodejsFunction(this, 'ImportMetadataLambda', {
      ...lambdaCommon,
      entry: 'src/importMetadata.ts',
    });
    const importMetadataTask = new tasks.LambdaInvoke(this, 'ImportMetadataTask', {
      lambdaFunction: importMetadata,
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
      ...lambdaCommon,
    });
    ingestBucket.grantReadWrite(sendFailureNotification);

    const sendFailureNotificationTask = new tasks.LambdaInvoke(this, 'sendFailureNotificationTask', {
      lambdaFunction: sendFailureNotification,
    });

    const parallel = new sfn.Parallel(this, 'ParallelErrorCatcher');

    const addToCatalogFlow = sfn.Chain
      .start(addToCatalogTask);

    const importMetadataFlow = sfn.Chain
      .start(importMetadataTask);

    const workflow = sfn.Chain
      .start(rejectEmptyFilesTask)
      .next(checkCatalogForItemTask)
      .next(checkIfPDSCTask)
      .next(
        new sfn.Choice(this, 'Is PDSC File?')
          .when(sfn.Condition.booleanEquals('$.pdscCheck.isPDSCFile', true), addToCatalogFlow)
          .when(sfn.Condition.booleanEquals('$.pdscCheck.isPDSCFile', false), importMetadataFlow),
      );

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
      ...lambdaCommon,
      environment: {
        ...lambdaCommon.environment,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
    });

    const s3EventSource = new eventsources.S3EventSource(ingestBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'incoming/' }],
    });
    processS3Event.addEventSource(s3EventSource);

    stateMachine.grantStartExecution(processS3Event);
  }
}
