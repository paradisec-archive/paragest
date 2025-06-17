import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import { LambdaStep, FargateStep, genLambdaProps } from './constructs/step';

// TODO: Be more specific on where functions can read and write

export class ParagestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.env?.account === '618916419351' ? 'prod' : 'stage';

    const concurrencyTable = new dynamodb.TableV2(this, 'ConcurrencyTable', {
      tableName: 'ConcurrencyTable',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    });

    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
      lifecycleRules: [
        { prefix: 'rejected/', expiration: cdk.Duration.days(4 * 7) },
        { prefix: 'output/', expiration: cdk.Duration.days(4 * 7) },
      ],
    });

    const catalogBucket = s3.Bucket.fromBucketName(this, 'CatalogBucket', `nabu-catalog-${env}`);

    const nabuOauthSecret = new secretsmanager.Secret(this, 'NabuOAuthSecret', {
      description: 'OAuth credentials for Nabu',
      secretName: '/paragest/nabu/oauth',
      secretObjectValue: {
        clientId: cdk.SecretValue.unsafePlainText('FIXME'),
        clientSecret: cdk.SecretValue.unsafePlainText('FIXME'),
      },
    });

    // /////////////////////////////
    // Batch
    // /////////////////////////////

    const vpc = ec2.Vpc.fromLookup(this, 'FargateVPC', {
      vpcId: ssm.StringParameter.valueFromLookup(this, '/usyd/resources/vpc-id'),
    });
    const dataSubnets = ['a', 'b', 'c'].map((az, index) => {
      const subnetId = ssm.StringParameter.valueForStringParameter(
        this,
        `/usyd/resources/subnets/isolated/apse2${az}-id`,
      );
      const availabilityZone = `ap-southeast-2${az}`;
      const subnet = ec2.Subnet.fromSubnetAttributes(this, `DataSubnet${index}`, { subnetId, availabilityZone });
      cdk.Annotations.of(subnet).acknowledgeWarning('@aws-cdk/aws-ec2:noSubnetRouteTableId');

      return subnet;
    });

    // NOTE: We have a special larger subnet in prod
    if (env === 'prod') {
      dataSubnets.pop();
      dataSubnets.pop();
      dataSubnets.pop();
      dataSubnets.push(
        ec2.Subnet.fromSubnetAttributes(this, 'DataSubnetLarge', {
          subnetId: 'subnet-04ae1ab6bd26154b3',
          availabilityZone: 'ap-southeast-2a',
        }),
      );
    }

    const fileSystem = new efs.FileSystem(this, 'FargateFileSystem', {
      vpc,
      vpcSubnets: {
        subnets: dataSubnets,
      },
    });

    const accessPoint = fileSystem.addAccessPoint('ServiceAccessPoint', {
      path: '/paragest',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });

    const batchEnv = new batch.FargateComputeEnvironment(this, 'FargateBatch', {
      vpc,
      vpcSubnets: {
        subnets: dataSubnets,
      },
      updateToLatestImageVersion: true,
      // spot: true,
      // NOTE: Leaving this at default of 256 means because we allocate 8 vCPUs per task, we can only run 32 tasks at a time
      // NOTE: This helps us not run out of IPs
      // maxvCpus: 256
    });
    fileSystem.connections.allowDefaultPortFrom(batchEnv.securityGroups[0]);

    const volume = batch.EcsVolume.efs({
      name: 'efs',
      fileSystem,
      accessPointId: accessPoint.accessPointId,
      containerPath: '/mnt/efs',
      enableTransitEncryption: true,
      useJobRole: true,
    });

    const jobQueue = new batch.JobQueue(this, 'BatchQueue', {
      priority: 1,
      jobStateTimeLimitActions: [
        {
          action: batch.JobStateTimeLimitActionsAction.CANCEL,
          maxTime: cdk.Duration.minutes(30),
          reason: batch.JobStateTimeLimitActionsReason.INSUFFICIENT_INSTANCE_CAPACITY,
          state: batch.JobStateTimeLimitActionsState.RUNNABLE,
        },
      ],
    });
    jobQueue.addComputeEnvironment(batchEnv, 1);

    // /////////////////////////////
    // Common Steps
    // /////////////////////////////
    const shared = {
      env,
      volume,
      jobQueue,
      concurrencyTable,
    };

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
    const checkItemIdentifierLengthStep = new LambdaStep(this, 'CheckItemIdentifierLength', {
      shared,
      src: 'check-item-identifier-length.ts',
    });
    const checkCatalogForItemStep = new LambdaStep(this, 'CheckCatalogForItem', {
      shared,
      src: 'check-catalog-for-item.ts',
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    const checkIfSpecialStep = new LambdaStep(this, 'CheckIfSpecial', {
      shared,
      src: 'check-if-special.ts',
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    const checkIsDAMSmartStep = new LambdaStep(this, 'CheckIfDAMSmart', {
      shared,
      src: 'check-if-damsmart.ts',
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    // /////////////////////////////
    // Add to Catalog Steps
    // /////////////////////////////
    const addToCatalogStep = new FargateStep(this, 'AddToCatalog', {
      shared,
      src: 'add-to-catalog.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const addToCatalogFlow = sfn.Chain.start(addToCatalogStep.task).next(processSuccessStep.task);

    const detectAndValidateMediaStep = new LambdaStep(this, 'detectAndValidateMedia', {
      shared,
      src: 'detect-and-validate-media.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15) },
      nodeModules: ['@npcz/magic'],
    });

    const checkMetadataReadyStep = new LambdaStep(this, 'CheckMetadataReady', {
      shared,
      src: 'check-metadata-ready.ts',
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
    const createBWFStep = new FargateStep(this, 'CreateBWF', {
      shared,
      src: 'audio/create-bwf.ts',
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });
    const createPresentationStep = new FargateStep(this, 'CreatePresentationStep', {
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
      .next(createBWFStep.task)
      .next(createPresentationStep.task)
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
      src: 'handle-special.ts',
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

    const damsmartDetectAndValidateMediaBigStep = new LambdaStep(this, 'damsmartDetectAndValidateMediaBig', {
      shared,
      src: 'detect-and-validate-media.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15) },
      nodeModules: ['@npcz/magic'],
    });

    const damsmartDetectAndValidateMediaSmallStep = new LambdaStep(this, 'damsmartDetectAndValidateMediaSmall', {
      shared,
      src: 'detect-and-validate-media.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
      lambdaProps: { memorySize: 10240, timeout: cdk.Duration.minutes(15) },
      nodeModules: ['@npcz/magic'],
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
      src: 'add-to-catalog.ts',
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
      src: 'add-to-catalog.ts',
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const bigFileFlow = sfn.Chain.start(damsmartDetectAndValidateMediaBigStep.task)
      .next(damsmartCreateOtherArchivalBigStep.task)
      .next(addToCatalogBigStep.task);
    const smallFileFlow = sfn.Chain.start(prepareOtherFileEventStep.task)
      .next(damsmartDetectAndValidateMediaSmallStep.task)
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
        'meta.retryCount.$': 'States.MathAdd($.meta.retryCount, 1)',
        'isDAMSmartOtherPresent.$': '$.isDAMSmartOtherPresent',
      },
      resultPath: '$',
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
      .next(checkItemIdentifierLengthStep.task)
      .next(detectAndValidateMediaStep.task)
      .next(checkMetadataReadyStep.task)
      .next(checkIsDAMSmartStep.task)
      .next(
        new sfn.Choice(this, 'Is DAMSmart Folder?')
          .when(sfn.Condition.booleanEquals('$.isDAMSmart', true), damSmartFlow)
          .when(sfn.Condition.booleanEquals('$.isDAMSmart', false), mediaFlow),
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

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineName: 'Paragest',
      timeout: cdk.Duration.hours(10),
    });

    const processS3Event = new nodejs.NodejsFunction(
      this,
      'ProcessS3EventLambda',
      genLambdaProps({
        shared,
        src: 'process-s3-event.ts',
        lambdaProps: { environment: { STATE_MACHINE_ARN: stateMachine.stateMachineArn } },
      }),
    );

    stateMachine.grantStartExecution(processS3Event);
    ingestBucket.grantRead(processS3Event);

    const s3IncomingEventSource = new eventsources.S3EventSource(ingestBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'incoming/' }],
    });
    processS3Event.addEventSource(s3IncomingEventSource);
    const s3DAMSmartEventSource = new eventsources.S3EventSource(ingestBucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'damsmart/' }],
    });
    processS3Event.addEventSource(s3DAMSmartEventSource);
  }
}
