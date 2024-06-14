import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

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
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.gibibytes(10),
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

    type paragestStepOpts = {
      taskProps?: Partial<tasks.LambdaInvokeProps>;
      lambdaProps?: nodejs.NodejsFunctionProps & { nodeModules?: string[] };
      grantFunc?: (lamdaFunc: nodejs.NodejsFunction) => void; // eslint-disable-line no-unused-vars
    };
    const paragestStep = (stepId: string, entry: string, { lambdaProps, grantFunc }: paragestStepOpts = {}) => {
      const { nodeModules, ...lambdaPropsRest } = lambdaProps ?? {};
      const lambdaFunction = new nodejs.NodejsFunction(this, `${stepId}Lambda`, {
        ...lambdaCommon,
        ...lambdaPropsRest,
        bundling: {
          ...lambdaCommon.bundling,
          nodeModules,
        },
        entry,
      });
      grantFunc?.(lambdaFunction);

      const task = new tasks.LambdaInvoke(this, `${stepId}Task`, {
        lambdaFunction,
        outputPath: '$.Payload',
      });

      return task;
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

    const imageDocker = lambda.Code.fromDockerBuild(path.join(__dirname, '..', 'docker', 'imagelayer'));
    const imageLayer = new lambda.LayerVersion(this, 'ImageLayer', {
      code: imageDocker,
      description: 'Image Layer',
    });

    // const toSnakeCase = (str: string) =>
    //   `${str.charAt(0).toLowerCase()}${str.slice(1)}`.replace(/([A-Z])/g, '-$1').toLowerCase();

    // const paragestContainerStep = (stepId: string, { lambdaProps, grantFunc }: paragestStepOpts = {}) => {
    //   const lambdaFunction = new lambda.DockerImageFunction(this, `${stepId}Lambda`, {
    //     code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..'), {
    //       file: `docker/${toSnakeCase(stepId)}/Dockerfile`,
    //     }),
    //     ...lambdaCommon,
    //     ...lambdaProps,
    //   });
    //   grantFunc?.(lambdaFunction);
    //
    //   const task = new tasks.LambdaInvoke(this, `${stepId}Task`, {
    //     lambdaFunction,
    //     outputPath: '$.Payload',
    //   });
    //
    //   return task;
    // };

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

    const processFailureStep = paragestStep('ProcessFailure', 'src/process-failure.ts', {
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

    const processSuccessStep = paragestStep('ProcessSuccess', 'src/process-success.ts', {
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

    const rejectEmptyFilesStep = paragestStep('RejectEmptyFiles', 'src/reject-empty-files.ts');
    const checkItemIdentifierLengthStep = paragestStep(
      'CheckItemIdentifierLength',
      'src/check-item-identifier-length.ts',
    );
    const checkCatalogForItemStep = paragestStep('CheckCatalogForItem', 'src/check-catalog-for-item.ts', {
      grantFunc: (lambdaFunc) => nabuOauthSecret.grantRead(lambdaFunc),
    });
    const checkIfPDSCStep = paragestStep('CheckIfPDSC', 'src/check-if-pdsc.ts');

    // /////////////////////////////
    // Add to Catalog Steps
    // /////////////////////////////
    const addToCatalogStep = paragestStep('AddToCatalog', 'src/add-to-catalog.ts', {
      lambdaProps: { timeout: cdk.Duration.minutes(5), layers: [mediaLayer] },
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantRead(lambdaFunc);
        ingestBucket.grantDelete(lambdaFunc);
        catalogBucket.grantPut(lambdaFunc);
        catalogBucket.grantRead(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const addToCatalogFlow = sfn.Chain.start(addToCatalogStep).next(processSuccessStep);

    const detectAndValidateMediaStep = paragestStep('detectAndValidateMedia', 'src/detect-and-validate-media.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantRead(lambdaFunc);
      },
      lambdaProps: { nodeModules: ['@npcz/magic'] },
    });

    const checkMetadataReadyStep = paragestStep('CheckMetadataReady', 'src/check-metadata-ready.ts', {
      grantFunc: (lambdaFunc) => {
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    // /////////////////////////////
    // Audio Flow Steps
    // /////////////////////////////
    const convertAudioStep = paragestStep('ConvertAudio', 'src/audio/convert.ts', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
    });
    const fixSilenceStep = paragestStep('FixSilence', 'src/audio/fix-silence.ts', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
    });
    const setMaxVolumeStep = paragestStep('SetMaxVolume', 'src/audio/set-max-volume.ts', {
      grantFunc: (lambdaFunc) => ingestBucket.grantReadWrite(lambdaFunc),
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
    });
    const createBWFStep = paragestStep('CreateBWF', 'src/audio/create-bwf.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
    });
    const createPresentationStep = paragestStep('CreatePresentationStep', 'src/audio/create-presentation.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
    });
    const processAudioFlow = sfn.Chain.start(convertAudioStep)
      .next(fixSilenceStep)
      .next(setMaxVolumeStep)
      .next(createBWFStep)
      .next(createPresentationStep)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Video Flow Steps
    // /////////////////////////////
    const createVideoArchivalStep = paragestStep('CreateVideoArchival', 'src/video/create-archival.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
    });

    const createVideoPresentationStep = paragestStep(
      'CreateVideoPresentationStep',
      'src/video/create-presentation.ts',
      {
        grantFunc: (lambdaFunc) => {
          ingestBucket.grantReadWrite(lambdaFunc);
          nabuOauthSecret.grantRead(lambdaFunc);
        },
        lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15), layers: [mediaLayer] },
      },
    );
    const processVideoFlow = sfn.Chain.start(createVideoArchivalStep)
      .next(createVideoPresentationStep)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Image Flow Steps
    // /////////////////////////////
    const createImageArchivalStep = paragestStep('CreateImageArchival', 'src/image/create-archival.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
      lambdaProps: { layers: [imageLayer], timeout: cdk.Duration.minutes(15), memorySize: 10240 },
    });

    const createImagePresentationStep = paragestStep(
      'CreateImagePresentationStep',
      'src/image/create-presentation.ts',
      {
        grantFunc: (lambdaFunc) => {
          ingestBucket.grantReadWrite(lambdaFunc);
          nabuOauthSecret.grantRead(lambdaFunc);
        },
        lambdaProps: { layers: [imageLayer], timeout: cdk.Duration.minutes(15), memorySize: 10240 },
      },
    );
    const processImageFlow = sfn.Chain.start(createImageArchivalStep)
      .next(createImagePresentationStep)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Other Flow Steps
    // /////////////////////////////
    const createOtherArchivalStep = paragestStep('CreateOtherArchival', 'src/other/create-archival.ts', {
      grantFunc: (lambdaFunc) => {
        ingestBucket.grantReadWrite(lambdaFunc);
        nabuOauthSecret.grantRead(lambdaFunc);
      },
    });

    const processOtherFlow = sfn.Chain.start(createOtherArchivalStep).next(addToCatalogFlow);

    // /////////////////////////////
    // MediaFlow
    // /////////////////////////////

    const mediaFlow = sfn.Chain.start(detectAndValidateMediaStep)
      .next(checkMetadataReadyStep)
      .next(
        new sfn.Choice(this, 'Media Type')
          .when(sfn.Condition.stringEquals('$.mediaType', 'audio'), processAudioFlow)
          .when(sfn.Condition.stringEquals('$.mediaType', 'video'), processVideoFlow)
          .when(sfn.Condition.stringEquals('$.mediaType', 'image'), processImageFlow)
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
      entry: 'src/process-s3-event.ts',
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
