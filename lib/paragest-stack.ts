import * as path from 'node:path';
import { execSync } from 'node:child_process';

import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import * as batch from 'aws-cdk-lib/aws-batch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SecretValue } from 'aws-cdk-lib';
import type { IRole } from 'aws-cdk-lib/aws-iam';

// TODO: Be more specific on where functions can read and write

function getGitSha(file: string) {
  // We want the SHA to change only when the file or deps change
  return execSync(`git log -1 --format=format:%h -- ${file} src/lib`).toString().trim();
}

export class ParagestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.env?.account === '618916419351' ? 'prod' : 'stage';

    const concurrencyTable = new dynamodb.TableV2(this, 'ConcurrencyTable', {
      tableName: 'ConcurrencyTable',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    });

    const lambdaCommon: nodejs.NodejsFunctionProps = {
      environment: {
        PARAGEST_ENV: env,
        SENTRY_DSN: 'https://e36e8aa3d034861a3803d2edbd4773ff@o4504801902985216.ingest.sentry.io/4506375864254464',
        NODE_OPTIONS: '--enable-source-maps',
        CONCURRENCY_TABLE_NAME: concurrencyTable.tableName,
      },
      runtime: lambda.Runtime.NODEJS_22_X,
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
          define: {
            'process.env.SENTRY_RELEASE': JSON.stringify(getGitSha(entry)),
          },
        },
        entry,
      });
      grantFunc?.(lambdaFunction);

      concurrencyTable.grantReadWriteData(lambdaFunction);

      const task = new tasks.LambdaInvoke(this, `${stepId}Task`, {
        lambdaFunction,
        outputPath: '$.Payload',
      });

      return task;
    };

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
        clientId: SecretValue.unsafePlainText('FIXME'),
        clientSecret: SecretValue.unsafePlainText('FIXME'),
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

    type ParagestFargateOpts = {
      grantFunc?: (role: IRole) => void; // eslint-disable-line no-unused-vars
      jobProps?: Partial<tasks.BatchSubmitJobProps>;
    };
    const paragestFargateStep = (stepId: string, source: string, { grantFunc, jobProps }: ParagestFargateOpts = {}) => {
      // eslint-disable-line no-unused-vars
      const image = new ecrAssets.DockerImageAsset(this, `${stepId}DockerImage`, {
        directory: path.join(__dirname, '..'),
        file: 'docker/fargate/Dockerfile',
        buildArgs: {
          SOURCE_FILE: source,
        },
      });
      const jobRole = new iam.Role(this, `${stepId}JobRole`, {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      });

      const jobDef = new batch.EcsJobDefinition(this, `${stepId}JobDef`, {
        container: new batch.EcsFargateContainerDefinition(this, `${stepId}FargateContainer`, {
          image: ecs.ContainerImage.fromDockerImageAsset(image),
          memory: cdk.Size.gibibytes(32),
          cpu: 16,
          fargateCpuArchitecture: ecs.CpuArchitecture.X86_64,
          fargateOperatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
          jobRole,
          volumes: [
            batch.EcsVolume.efs({
              name: 'efs',
              fileSystem,
              accessPointId: accessPoint.accessPointId,
              containerPath: '/mnt/efs',
              enableTransitEncryption: true,
              useJobRole: true,
            }),
          ],
        }),
      });

      const task = new tasks.BatchSubmitJob(this, `${stepId}SubmitJob`, {
        jobDefinitionArn: jobDef.jobDefinitionArn,
        jobQueueArn: jobQueue.jobQueueArn,
        jobName: `${stepId}Job`,
        containerOverrides: {
          environment: {
            SFN_INPUT: sfn.JsonPath.jsonToString(sfn.JsonPath.stringAt('$')),
            SFN_TASK_TOKEN: sfn.JsonPath.taskToken,
            PARAGEST_ENV: env,
            SENTRY_DSN: 'https://e36e8aa3d034861a3803d2edbd4773ff@o4504801902985216.ingest.sentry.io/4506375864254464',
            SENTRY_RELEASE: JSON.stringify(getGitSha(source)),
            CONCURRENCY_TABLE_NAME: concurrencyTable.tableName,
          },
        },
        outputPath: '$',
        taskTimeout: sfn.Timeout.duration(cdk.Duration.minutes(15)),
        ...jobProps,
      });

      grantFunc?.(jobRole);

      concurrencyTable.grantReadWriteData(jobRole);
      fileSystem.grantReadWrite(jobRole);

      jobRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ['states:SendTaskSuccess', 'states:SendTaskFailure', 'states:SendTaskHeartbeat'],
          // TODO: Make this more specific
          resources: ['*'],
        }),
      );

      return task;
    };

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
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    const checkIfSpecialStep = paragestStep('CheckIfSpecial', 'src/check-if-special.ts', {
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    const checkIsDAMSmartStep = paragestStep('CheckIfDAMSmart', 'src/check-if-damsmart.ts', {
      grantFunc: (role) => nabuOauthSecret.grantRead(role),
    });

    // /////////////////////////////
    // Add to Catalog Steps
    // /////////////////////////////
    const addToCatalogStep = paragestFargateStep('AddToCatalog', 'add-to-catalog.ts', {
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const addToCatalogFlow = sfn.Chain.start(addToCatalogStep).next(processSuccessStep);

    const detectAndValidateMediaStep = paragestStep('detectAndValidateMedia', 'src/detect-and-validate-media.ts', {
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
      },
      lambdaProps: { nodeModules: ['@npcz/magic'], memorySize: 10240, timeout: cdk.Duration.minutes(15) },
    });

    const checkMetadataReadyStep = paragestStep('CheckMetadataReady', 'src/check-metadata-ready.ts', {
      grantFunc: (role) => {
        nabuOauthSecret.grantRead(role);
      },
    });

    // /////////////////////////////
    // Audio Flow Steps
    // /////////////////////////////
    const convertAudioStep = paragestFargateStep('ConvertAudio', 'audio/convert.ts', {
      grantFunc: (role) => ingestBucket.grantReadWrite(role),
    });
    const fixSilenceStep = paragestFargateStep('FixSilence', 'audio/fix-silence.ts', {
      grantFunc: (role) => ingestBucket.grantReadWrite(role),
    });
    const setMaxVolumeStep = paragestFargateStep('SetMaxVolume', 'audio/set-max-volume.ts', {
      grantFunc: (role) => ingestBucket.grantReadWrite(role),
    });
    const createBWFStep = paragestFargateStep('CreateBWF', 'audio/create-bwf.ts', {
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });
    const createPresentationStep = paragestFargateStep('CreatePresentationStep', 'audio/create-presentation.ts', {
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
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
    const createVideoArchivalStep = paragestFargateStep('CreateVideoArchival', 'video/create-archival.ts', {
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
      jobProps: { taskTimeout: sfn.Timeout.duration(cdk.Duration.hours(7)) },
    });

    const createVideoPresentationStep = paragestFargateStep(
      'CreateVideoPresentationStep',
      'video/create-presentation.ts',
      {
        grantFunc: (role) => {
          ingestBucket.grantReadWrite(role);
          nabuOauthSecret.grantRead(role);
        },
        jobProps: { taskTimeout: sfn.Timeout.duration(cdk.Duration.hours(7)) },
      },
    );
    const processVideoFlow = sfn.Chain.start(createVideoArchivalStep)
      .next(createVideoPresentationStep)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Image Flow Steps
    // /////////////////////////////
    const createImageArchivalStep = paragestFargateStep('CreateImageArchival', 'image/create-archival.ts', {
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const createImagePresentationStep = paragestFargateStep(
      'CreateImagePresentationStep',
      'image/create-presentation.ts',
      {
        grantFunc: (role) => {
          ingestBucket.grantReadWrite(role);
          nabuOauthSecret.grantRead(role);
        },
      },
    );
    const processImageFlow = sfn.Chain.start(createImageArchivalStep)
      .next(createImagePresentationStep)
      .next(addToCatalogFlow);

    // /////////////////////////////
    // Other Flow Steps
    // /////////////////////////////
    const createOtherArchivalStep = paragestStep('CreateOtherArchival', 'src/other/create-archival.ts', {
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    const handleSpecialStep = paragestStep('HandleSpecial', 'src/handle-special.ts', {
      grantFunc: (role) => {
        ingestBucket.grantReadWrite(role);
        ingestBucket.grantDelete(role);
        nabuOauthSecret.grantRead(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
      },
    });
    const processOtherFlow = sfn.Chain.start(createOtherArchivalStep).next(addToCatalogFlow);

    // /////////////////////////////
    // DamSmart
    // /////////////////////////////

    const checkForOtherDAMSmartFile = paragestStep(
      'CheckForOtherDAMSmartFile',
      'src/damsmart/check-for-other-file.ts',
      {
        grantFunc: (role) => {
          ingestBucket.grantReadWrite(role);
          nabuOauthSecret.grantRead(role);
        },
      },
    );

    const prepareOtherFileEventStep = paragestStep(
      'PrepareOtherFileEvent',
      'src/damsmart/prepare-other-file-event.ts',
      {
        grantFunc: (role) => {
          ingestBucket.grantRead(role);
        },
      },
    );

    const damsmartDetectAndValidateMediaStep = paragestStep(
      'damsmartDetectAndValidateMedia',
      'src/detect-and-validate-media.ts',
      {
        grantFunc: (role) => {
          ingestBucket.grantRead(role);
        },
        lambdaProps: { nodeModules: ['@npcz/magic'], memorySize: 10240, timeout: cdk.Duration.minutes(15) },
      },
    );

    const damsmartAddToCatalogStep = paragestFargateStep('DAMSmartAddToCatalog', 'add-to-catalog.ts', {
      grantFunc: (role) => {
        ingestBucket.grantRead(role);
        ingestBucket.grantDelete(role);
        catalogBucket.grantPut(role);
        catalogBucket.grantRead(role);
        nabuOauthSecret.grantRead(role);
      },
    });

    // const currentFileFlow = sfn.Chain.start(new sfn.Pass(this, 'NoOp2'));
    const otherFileFlow = sfn.Chain.start(prepareOtherFileEventStep).next(damsmartDetectAndValidateMediaStep);

    const parallelDAMSmartProcessing = new sfn.Parallel(this, 'ParallelDAMSmartProcessing');
    // parallelDAMSmartProcessing.branch(currentFileFlow);
    parallelDAMSmartProcessing.branch(otherFileFlow);

    const damSmartParallelFlow = sfn.Chain.start(parallelDAMSmartProcessing)
      .next(damsmartDetectAndValidateMediaStep)
      .next(damsmartAddToCatalogStep);

    const damSmartFlow = sfn.Chain.start(checkForOtherDAMSmartFile).next(
      new sfn.Choice(this, 'Is Other file ready?').when(
        sfn.Condition.booleanEquals('$.isDAMSmartOtherPresent', false),
        processSuccessStep,
      ),
      // .when(sfn.Condition.booleanEquals('$.isDAMSmartOtherPresent', true), damSmartParallelFlow),
    );

    // /////////////////////////////
    // MediaFlow
    // /////////////////////////////

    const mediaFlow = new sfn.Choice(this, 'Media Type')
      .when(sfn.Condition.stringEquals('$.mediaType', 'audio'), processAudioFlow)
      .when(sfn.Condition.stringEquals('$.mediaType', 'video'), processVideoFlow)
      .when(sfn.Condition.stringEquals('$.mediaType', 'image'), processImageFlow)
      .when(sfn.Condition.stringEquals('$.mediaType', 'other'), processOtherFlow);

    const metadataChecksFlow = sfn.Chain.start(checkCatalogForItemStep)
      .next(checkItemIdentifierLengthStep)
      .next(detectAndValidateMediaStep)
      .next(checkMetadataReadyStep)
      .next(checkIsDAMSmartStep)
      .next(
        new sfn.Choice(this, 'Is DAMSmart Folder?')
          .when(sfn.Condition.booleanEquals('$.isDAMSmart', true), damSmartFlow)
          .when(sfn.Condition.booleanEquals('$.isDAMSmart', false), mediaFlow),
      );

    const handleSpecialFlow = sfn.Chain.start(handleSpecialStep).next(processSuccessStep);

    const workflow = sfn.Chain.start(rejectEmptyFilesStep)
      .next(checkIfSpecialStep)
      .next(
        new sfn.Choice(this, 'Is Special File?')
          .when(sfn.Condition.booleanEquals('$.isSpecialFile', true), handleSpecialFlow)
          .when(sfn.Condition.booleanEquals('$.isSpecialFile', false), metadataChecksFlow),
      );

    const parallel = new sfn.Parallel(this, 'ParallelErrorCatcher');
    parallel.branch(workflow);
    const failure = sfn.Chain.start(processFailureStep).next(failureState);
    parallel.addCatch(failure);

    const definition = sfn.Chain.start(startState).next(parallel).next(successState);

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineName: 'Paragest',
      timeout: cdk.Duration.hours(10),
    });

    const processS3Event = new nodejs.NodejsFunction(this, 'ProcessS3EventLambda', {
      entry: 'src/process-s3-event.ts',
      ...lambdaCommon,
      bundling: {
        ...lambdaCommon.bundling,
        define: {
          'process.env.SENTRY_RELEASE': JSON.stringify(getGitSha('src/process-s3-event.ts')),
        },
      },
      environment: {
        ...lambdaCommon.environment,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
    });
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
