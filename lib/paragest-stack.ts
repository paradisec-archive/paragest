import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
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
        SENTRY_DSN: 'https://e36e8aa3d034861a3803d2edbd4773ff@o4504801902985216.ingest.sentry.io/4506375864254464',
        NODE_OPTIONS: '--enable-source-maps',
      },
      runtime: lambda.Runtime.NODEJS_LATEST,
      memorySize: 2048,
      timeout: cdk.Duration.seconds(120),
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'esnext',
        mainFields: ['module', 'main'],
        // DIrty hack from https://github.com/evanw/esbuild/pull/2067
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        loader: {
          '.node': 'copy', // for sentry profiling library
        },
        sourceMap: true,
        minify: true,
      },
    };

    const mediaDocker = lambda.Code.fromDockerBuild(path.join(__dirname, '..', 'docker', 'medialayer'), {
      buildArgs: {
        MEDIAINFO_VERSION: '23.11',
        LIBZEN_VERSION: '0.4.41',
        BWF_METAEDIT_VERSION: '23.04',
      },
    });
    const mediaLayer = new lambda.LayerVersion(this, 'MediaLayer', {
      code: mediaDocker,
      description: 'Media Layer',
    });

    type paragestStepOpts = {
      taskProps?: Partial<tasks.LambdaInvokeProps>;
      lambdaProps?: nodejs.NodejsFunctionProps;
      grantFunc?: (lamdaFunc: nodejs.NodejsFunction) => void; // eslint-disable-line no-unused-vars
    };
    const paragestStep = (stepId: string, entry: string, { lambdaProps, grantFunc }: paragestStepOpts = {}) => {
      const lambdaFunction = new nodejs.NodejsFunction(this, `${stepId}Lambda`, {
        ...lambdaCommon,
        ...lambdaProps,
        entry,
      });
      grantFunc?.(lambdaFunction);

      const task = new tasks.LambdaInvoke(this, `${stepId}Task`, {
        lambdaFunction,
        outputPath: '$.Payload',
      });

      return task;
    };

    const paragestContainerStep = (stepId: string, { lambdaProps, grantFunc }: paragestStepOpts = {}) => {
      const lambdaFunction = new lambda.DockerImageFunction(this, `${stepId}Lambda`, {
        code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..'), {
          file: `docker/${stepId}/Dockerfile`,
        }),
        ...lambdaCommon,
        ...lambdaProps,
      });
      grantFunc?.(lambdaFunction);

      const task = new tasks.LambdaInvoke(this, `${stepId}Task`, {
        lambdaFunction,
        outputPath: '$.Payload',
      });

      return task;
    };

    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
    });
    const catalogBucket = s3.Bucket.fromBucketName(this, 'CatalogBucket', `nabu-catalog-${env}`);

    const nabuOauthSecret = new secretsmanager.Secret(this, 'NabuOAuthSecret', {
      description: 'OAuth credentials for Nabu',
      secretName: '/paragest/nabu/oauth',
      secretObjectValue: {
        clientId: SecretValue.unsafePlainText('FIXME'),
        clientSecret: SecretValue.unsafePlainText('FIXME'),
      },
    });

    // /////////////////////////////
    // Common Steps
    // /////////////////////////////
    const startState = new sfn.Pass(this, 'StartState');
    const successState = new sfn.Succeed(this, 'SuccessState');
    const failureState = new sfn.Fail(this, 'FailureState');

    const processFailureStep = paragestStep('ProcessFailure', 'src/processFailure.ts', {
      grantFunc: (lambdaFunc) => {
        lambdaFunc.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: ['*'],
          }),
        );
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const processSuccessStep = paragestStep('ProcessSuccess', 'src/processSuccess.ts', {
      grantFunc: (lambdaFunc) => {
        lambdaFunc.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: ['*'],
          }),
        );
        ingestBucket.grantDelete(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const rejectEmptyFilesStep = paragestStep('RejectEmptyFiles', 'src/rejectEmptyFiles.ts');
    const checkItemIdentifierLengthStep = paragestStep('CheckItemIdentifierLength', 'src/checkItemIdentifierLength.ts');
    const checkCatalogForItemStep = paragestStep('CheckCatalogForItem', 'src/checkCatalogForItem.ts', {
      grantFunc: (lambdaFunc) => nabuOauthSecret.grantRead(lambdaFunc),
    });
    const checkIfPDSCStep = paragestStep('CheckIfPDSC', 'src/checkIfPDSC.ts');

    // /////////////////////////////
    // Add to Catalog Steps
    // /////////////////////////////
    const addToCatalogStep = paragestStep('AddToCatalog', 'src/addToCatalog.ts', {
      lambdaProps: { ...lambdaCommon, timeout: cdk.Duration.minutes(5) },
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantRead(lambdaFunc);
        ingestBucket.grantDelete(lambdaFunc);
        catalogBucket.grantPut(lambdaFunc);
      },
    });

    const addToCatalogFlow = sfn.Chain.start(addToCatalogStep).next(processSuccessStep);

    const addMediaMetadataStep = paragestStep('AddMediaMetadata', 'src/addMediaMetadata.ts', {
      lambdaProps: { layers: [mediaLayer] },
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantRead(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const checkMetadataReadyStep = paragestStep('CheckMetadataReady', 'src/checkMetadataReady.ts', {
      grantFunc: (lambdaFunc) => {
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    // /////////////////////////////
    // Audio Flow Steps
    // /////////////////////////////
    const convertAudioStep = paragestStep('ConvertAudio', 'src/audio/convert.ts', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
      lambdaProps: { layers: [mediaLayer] },
    });
    const fixSilenceStep = paragestStep('FixSilence', 'src/audio/fixSilence.ts', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
      lambdaProps: { layers: [mediaLayer] },
    });
    const fixAlignmentStep = paragestContainerStep('FixAlignment', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
    });
    const setMaxVolumeStep = paragestStep('SetMaxVolume', 'src/audio/setMaxVolume.ts', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
      lambdaProps: { layers: [mediaLayer] },
    });
    const createBWFStep = paragestStep('CreateBWF', 'src/audio/createBWF.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
      lambdaProps: { layers: [mediaLayer] },
    });
    const createPresentationStep = paragestStep('CreatePresentationStep', 'src/audio/createPresentation.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
      lambdaProps: { layers: [mediaLayer] },
    });
    const processAudioFlow = sfn.Chain.start(convertAudioStep)
      .next(fixSilenceStep)
      .next(fixAlignmentStep)
      .next(setMaxVolumeStep)
      .next(createBWFStep)
      .next(createPresentationStep)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Video Flow Steps
    // /////////////////////////////
    const processVideoStep = paragestStep('ProcessVideo', 'src/processVideo.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantRead(lambdaFunc);
        // nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const processOtherStep = paragestStep('ProcessOther', 'src/processOther.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantRead(lambdaFunc);
        // nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const processVideoFlow = sfn.Chain.start(processVideoStep).next(addToCatalogFlow);
    const processOtherFlow = sfn.Chain.start(processOtherStep).next(addToCatalogFlow);

    const mediaFlow = sfn.Chain.start(addMediaMetadataStep)
      .next(checkMetadataReadyStep)
      .next(
        new sfn.Choice(this, 'Media Type')
          .when(sfn.Condition.stringEquals('$.mediaType', 'audio'), processAudioFlow)
          .when(sfn.Condition.stringEquals('$.mediaType', 'video'), processVideoFlow)
          .when(sfn.Condition.stringEquals('$.mediaType', 'other'), processOtherFlow),
      );

    const workflow = sfn.Chain.start(rejectEmptyFilesStep)
      .next(checkCatalogForItemStep)
      .next(checkItemIdentifierLengthStep)
      .next(checkIfPDSCStep)
      .next(
        new sfn.Choice(this, 'Is PDSC File?')
          .when(sfn.Condition.booleanEquals('$.isPDSCFile', true), addToCatalogFlow)
          .when(sfn.Condition.booleanEquals('$.isPDSCFile', false), mediaFlow),
      );

    const parallel = new sfn.Parallel(this, 'ParallelErrorCatcher');
    parallel.branch(workflow);
    const failure = sfn.Chain.start(processFailureStep).next(failureState);
    parallel.addCatch(failure);

    const definition = sfn.Chain.start(startState).next(parallel).next(successState);

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
