import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

import { FargateStep, LambdaStep, type SharedProps } from './step';

type StateMachineProps = SharedProps & {
  ingestBucket: s3.Bucket;
  catalogBucket: s3.IBucket;
  nabuOauthSecret: secretsmanager.Secret;
};

export class StateMachine extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: StateMachineProps) {
    super(scope, id);

    const { catalogBucket, ingestBucket, nabuOauthSecret } = props;
    const shared = props;

    const startState = new sfn.Pass(this, 'StartState');
    const successState = new sfn.Succeed(this, 'SuccessState');
    const failureState = new sfn.Fail(this, 'FailureState');

    const processFailureStep = new LambdaStep(this, 'ProcessFailure', {
      shared,
      src: 'process-failure.ts',
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

    const processSuccessStep = new LambdaStep(this, 'ProcessSuccess', {
      shared,
      src: 'process-success.ts',
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

    const rejectEmptyFilesStep = new LambdaStep(this, 'RejectEmptyFiles', {
      shared,
      src: 'common/reject-empty-files.ts',
    });

    const checkCatalogForItemStep = new LambdaStep(this, 'CheckCatalogForItem', {
      shared,
      src: 'common/check-catalog-for-item.ts',
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    const checkIfSpecialStep = new LambdaStep(this, 'CheckIfSpecial', {
      shared,
      src: 'common/check-if-special.ts',
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(5) },
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    const checkIsDAMSmartStep = new LambdaStep(this, 'CheckIfDAMSmart', {
      shared,
      src: 'common/check-if-damsmart.ts',
    });

    // /////////////////////////////
    // Add to Catalog Steps
    // /////////////////////////////
    const addToCatalogStep = new FargateStep(this, 'AddToCatalog', {
      shared,
      src: 'common/add-to-catalog.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const addToCatalogFlow = sfn.Chain.start(addToCatalogStep.task).next(processSuccessStep.task);

    const downloadMediaStep = new LambdaStep(this, 'downloadMedia', {
      shared,
      src: 'common/download-media.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(5) },
    });

    const detectAndValidateMediaStep = new LambdaStep(this, 'DetectAndValidateMedia', {
      shared,
      src: 'common/detect-and-validate-media.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15) },
      nodeModules: ['@npcz/magic'],
    });

    const checkMetadataReadyStep = new LambdaStep(this, 'CheckMetadataReady', {
      shared,
      src: 'common/check-metadata-ready.ts',
      grantFunc: (role) => {
        nabuOauthSecret.grantRead(role);
      },
    });

    // /////////////////////////////
    // Audio Flow Steps
    // /////////////////////////////
    const convertAudioStep = new FargateStep(this, 'ConvertAudio', {
      shared,
      src: 'audio/convert.ts',
      grantFunc: (role) => ingestBucket.grantReadWrite(role),
    });
    const fixSilenceStep = new FargateStep(this, 'FixSilence', {
      shared,
      src: 'audio/fix-silence.ts',
      grantFunc: (role) => ingestBucket.grantReadWrite(role),
    });
    const setMaxVolumeStep = new FargateStep(this, 'SetMaxVolume', {
      shared,
      src: 'audio/set-max-volume.ts',
      grantFunc: (role) => ingestBucket.grantReadWrite(role),
    });
    const createAudioArchivalStep = new FargateStep(this, 'CreateAudioArchivalStep', {
      shared,
      src: 'audio/create-archival.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });
    const createAudioPresentationStep = new FargateStep(this, 'CreateAudioPresentationStep', {
      shared,
      src: 'audio/create-presentation.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });
    const processAudioFlow = sfn.Chain.start(convertAudioStep.task)
      .next(fixSilenceStep.task)
      .next(setMaxVolumeStep.task)
      .next(createAudioArchivalStep.task)
      .next(createAudioPresentationStep.task)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Video Flow Steps
    // /////////////////////////////
    const createVideoArchivalStep = new FargateStep(this, 'CreateVideoArchival', {
      shared,
      src: 'video/create-archival.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
      jobProps: { taskTimeout: sfn.Timeout.duration(cdk.Duration.hours(7)) },
    });

    const createVideoPresentationStep = new FargateStep(this, 'CreateVideoPresentationStep', {
      shared,
      src: 'video/create-presentation.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
      jobProps: { taskTimeout: sfn.Timeout.duration(cdk.Duration.hours(7)) },
    });
    const processVideoFlow = sfn.Chain.start(createVideoArchivalStep.task)
      .next(createVideoPresentationStep.task)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Image Flow Steps
    // /////////////////////////////
    const createImageArchivalStep = new FargateStep(this, 'CreateImageArchival', {
      shared,
      src: 'image/create-archival.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const createImagePresentationStep = new FargateStep(this, 'CreateImagePresentationStep', {
      shared,
      src: 'image/create-presentation.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });
    const processImageFlow = sfn.Chain.start(createImageArchivalStep.task)
      .next(createImagePresentationStep.task)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Other Flow Steps
    // /////////////////////////////
    const createOtherArchivalStep = new LambdaStep(this, 'CreateOtherArchival', {
      shared,
      src: 'other/create-archival.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const handleSpecialStep = new LambdaStep(this, 'HandleSpecial', {
      shared,
      src: 'common/handle-special.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        ingestBucket.grantDelete(role);
        nabuOauthSecret.grantRead(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
      },
    });
    const processOtherFlow = sfn.Chain.start(createOtherArchivalStep.task).next(addToCatalogFlow);

    // /////////////////////////////
    // DamSmart
    // /////////////////////////////

    // TODO: The below is all super messy refactor it one day

    const checkForOtherDAMSmartFileStep = new LambdaStep(this, 'CheckForOtherDAMSmartFile', {
      shared,
      src: 'damsmart/check-for-other-file.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const prepareOtherFileEventStep = new LambdaStep(this, 'PrepareOtherFileEvent', {
      shared,
      src: 'damsmart/prepare-other-file-event.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
    });

    const damsmartCreateOtherArchivalBigStep = new LambdaStep(this, 'DamsmartCreateOtherArchivalBig', {
      shared,
      src: 'other/create-archival.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const damsmartCreateOtherArchivalSmallStep = new LambdaStep(this, 'DamsmartCreateOtherArchivalSmall', {
      shared,
      src: 'other/create-archival.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const addToCatalogBigStep = new FargateStep(this, 'AddToCatalogBig', {
      shared,
      src: 'common/add-to-catalog.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const addToCatalogSmallStep = new FargateStep(this, 'AddToCatalogSmall', {
      shared,
      src: 'common/add-to-catalog.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const bigFileFlow = sfn.Chain.start(damsmartCreateOtherArchivalBigStep.task).next(addToCatalogBigStep.task);
    const smallFileFlow = sfn.Chain.start(prepareOtherFileEventStep.task)
      .next(damsmartCreateOtherArchivalSmallStep.task)
      .next(addToCatalogSmallStep.task);

    const parallelDAMSmartProcessing = new sfn.Parallel(this, 'ParallelDAMSmartProcessing');
    parallelDAMSmartProcessing.branch(bigFileFlow);
    parallelDAMSmartProcessing.branch(smallFileFlow);

    const damSmartParallelFlow = sfn.Chain.start(parallelDAMSmartProcessing);

    const DAMSMART_RETRIES = 10;

    const damsmartCounter = new sfn.Pass(this, 'DAMSmarCounter', {
      result: sfn.Result.fromObject({ retryCount: 0 }),
      resultPath: '$.meta',
    });

    const damsmartIncrement = new sfn.Pass(this, 'DamsmartIncrement', {
      parameters: {
        'retryCount.$': 'States.MathAdd($.meta.retryCount, 1)',
      },
      resultPath: '$.meta',
    });

    const damsmartWait = new sfn.Wait(this, 'DamsmartWait', {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(2)),
    });

    const damsmartLoopEnd = new sfn.Fail(this, 'Too Many Retries', {
      cause: 'Exceeded maximum retries',
      error: 'RetryLimitExceeded',
    });

    const damsmartRetryChoice = new sfn.Choice(this, 'DAMSmart Retry Again?');

    const checkForOtherDAMSmartFileState = sfn.Chain.start(checkForOtherDAMSmartFileStep.task).next(
      new sfn.Choice(this, 'Is Other file ready?')
        .when(sfn.Condition.stringEquals('$.isDAMSmartOtherPresent', 'small-file'), processSuccessStep.task)
        .when(sfn.Condition.stringEquals('$.isDAMSmartOtherPresent', 'big-file'), damSmartParallelFlow)
        .when(
          sfn.Condition.stringEquals('$.isDAMSmartOtherPresent', 'wait'),
          damsmartIncrement.next(damsmartRetryChoice),
        ),
    );

    damsmartRetryChoice
      .when(
        sfn.Condition.numberLessThan('$.meta.retryCount', DAMSMART_RETRIES),
        damsmartWait.next(checkForOtherDAMSmartFileState),
      )
      .otherwise(damsmartLoopEnd);

    const damSmartFlow = sfn.Chain.start(damsmartCounter).next(checkForOtherDAMSmartFileState);

    // /////////////////////////////
    // MediaFlow
    // /////////////////////////////

    const mediaFlow = new sfn.Choice(this, 'Media Type')
      .when(sfn.Condition.stringEquals('$.mediaType', 'audio'), processAudioFlow)
      .when(sfn.Condition.stringEquals('$.mediaType', 'video'), processVideoFlow)
      .when(sfn.Condition.stringEquals('$.mediaType', 'image'), processImageFlow)
      .when(sfn.Condition.stringEquals('$.mediaType', 'other'), processOtherFlow);

    const metadataChecksFlow = sfn.Chain.start(checkCatalogForItemStep.task)
      .next(downloadMediaStep.task)
      .next(detectAndValidateMediaStep.task)
      .next(checkMetadataReadyStep.task)
      .next(checkIsDAMSmartStep.task)
      .next(
        new sfn.Choice(this, 'Is DAMSmart Folder?')
          .when(sfn.Condition.booleanEquals('$.isDamsmart', true), damSmartFlow)
          .when(sfn.Condition.booleanEquals('$.isDamsmart', false), mediaFlow),
      );

    const handleSpecialFlow = sfn.Chain.start(handleSpecialStep.task).next(processSuccessStep.task);

    const workflow = sfn.Chain.start(rejectEmptyFilesStep.task)
      .next(checkIfSpecialStep.task)
      .next(
        new sfn.Choice(this, 'Is Special File?')
          .when(sfn.Condition.booleanEquals('$.isSpecialFile', true), handleSpecialFlow)
          .when(sfn.Condition.booleanEquals('$.isSpecialFile', false), metadataChecksFlow),
      );

    const parallel = new sfn.Parallel(this, 'ParallelErrorCatcher');
    parallel.branch(workflow);
    const failure = sfn.Chain.start(processFailureStep.task).next(failureState);
    parallel.addCatch(failure);

    const definition = sfn.Chain.start(startState).next(parallel).next(successState);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineName: 'Paragest',
      timeout: cdk.Duration.hours(10),
    });
  }
}
