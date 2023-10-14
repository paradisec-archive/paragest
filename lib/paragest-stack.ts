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
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'esnext',
        mainFields: ['module', 'main'],
        // DIrty hack from https://github.com/evanw/esbuild/pull/2067
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
    };

    const paragestStepDefaults: Partial<tasks.LambdaInvokeProps> = { resultPath: sfn.JsonPath.DISCARD };
    const paragestStep = (stepId: string, entry: string, taskProps = paragestStepDefaults) => {
      const lambdaFunction = new nodejs.NodejsFunction(this, `${stepId}Lambda`, {
        ...lambdaCommon,
        entry,
      });

      const task = new tasks.LambdaInvoke(this, `${stepId}Task`, {
        lambdaFunction,
        ...taskProps,
      });

      return task;
    };

    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
    });
    const catalogBucket = s3.Bucket.fromBucketName(this, 'CatalogBucket', `nabu-catalog-${env}`);

    const startState = new sfn.Pass(this, 'StartState');
    const successState = new sfn.Succeed(this, 'SuccessState');
    const failureState = new sfn.Fail(this, 'FailureState');
    // const choice = new sfn.Choice(this, 'Did it work?');

    const rejectEmptyFilesStep = paragestStep('RejectEmptyFiles', 'src/rejectEmptyFiles.ts');
    const checkItemIdentifierLengthStep = paragestStep('CheckItemIdentifierLength', 'src/checkItemIdentifierLength.ts');
    const checkCatalogForItemStep = paragestStep('CheckCatalogForItem', 'src/checkCatalogForItem.ts', {
      resultPath: sfn.JsonPath.stringAt('$.details'),
      resultSelector: {
        collectionIdentifier: sfn.JsonPath.stringAt('$.Payload.collectionIdentifier'),
        itemIdentifier: sfn.JsonPath.stringAt('$.Payload.itemIdentifier'),
        filename: sfn.JsonPath.stringAt('$.Payload.filename'),
        extension: sfn.JsonPath.stringAt('$.Payload.extension'),
      },
    });
    const checkIfPDSCStep = paragestStep('CheckIfPDSC', 'src/checkIfPDSC.ts', {
      resultPath: sfn.JsonPath.stringAt('$.pdscCheck'),
      resultSelector: {
        isPDSCFile: sfn.JsonPath.stringAt('$.Payload'),
      },
    });
    const addToCatalogStep = paragestStep('AddToCatalog', 'src/addToCatalog.ts');
    ingestBucket.grantRead(addToCatalogStep['props'].lambdaFunction); // eslint-disable-line dot-notation
    ingestBucket.grantDelete(addToCatalogStep['props'].lambdaFunction); // eslint-disable-line dot-notation
    catalogBucket.grantPut(addToCatalogStep['props'].lambdaFunction); // eslint-disable-line dot-notation

    const addMediaMetadataStep = paragestStep('AddMediaMetadata', 'src/addMediaMetadata.ts', {});
    ingestBucket.grantRead(addMediaMetadataStep['props'].lambdaFunction); // eslint-disable-line dot-notation

    const nabuOauthSecret = new secretsmanager.Secret(this, 'NabuOAuthSecret', {
      description: 'OAuth credentials for Nabu',
      secretName: '/paragest/nabu/oauth',
      secretObjectValue: {
        clientId: SecretValue.unsafePlainText('FIXME'),
        clientSecret: SecretValue.unsafePlainText('FIXME'),
      },
    });
    nabuOauthSecret.grantRead(checkCatalogForItemStep['props'].lambdaFunction); // eslint-disable-line dot-notation
    nabuOauthSecret.grantRead(addMediaMetadataStep['props'].lambdaFunction); // eslint-disable-line dot-notation

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
      .start(addToCatalogStep);

    const metadataFlow = sfn.Chain
      .start(addMediaMetadataStep);

    const workflow = sfn.Chain
      .start(rejectEmptyFilesStep)
      .next(checkCatalogForItemStep)
      .next(checkItemIdentifierLengthStep)
      .next(checkIfPDSCStep)
      .next(
        new sfn.Choice(this, 'Is PDSC File?')
          .when(sfn.Condition.booleanEquals('$.pdscCheck.isPDSCFile', true), addToCatalogFlow)
          .when(sfn.Condition.booleanEquals('$.pdscCheck.isPDSCFile', false), metadataFlow),
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
