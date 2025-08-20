import { execSync } from 'node:child_process';
import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import * as batch from 'aws-cdk-lib/aws-batch';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as efs from 'aws-cdk-lib/aws-efs';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export type SharedProps = {
  env: string;
  concurrencyTable: dynamodb.TableV2;
  volume: batch.EfsVolume;
  jobQueue: batch.JobQueue;
  accessPoint: efs.AccessPoint;
  vpc: ec2.IVpc;
  subnets: ec2.ISubnet[];
  nabuDnsName: string;
  sentryDnsName: string;
  dynamodbDnsName: string;
  sesSmtpSecret: secretsmanager.ISecret;
};

type LambdaStepProps = {
  src: string;
  taskProps?: Partial<tasks.LambdaInvokeProps>;
  lambdaProps?: nodejs.NodejsFunctionProps;
  nodeModules?: string[];
  grantFunc?: (lamdaFunc: nodejs.NodejsFunction) => void;
  jobProps?: Partial<tasks.BatchSubmitJobProps>;
  shared: SharedProps;
};

type LambdaProps = Pick<LambdaStepProps, 'src' | 'lambdaProps' | 'nodeModules' | 'shared'>;

// We want the SHA to change only when the file or deps change
const getGitSha = (file: string) => execSync(`git log -1 --format=format:%h -- ${file} src/lib`).toString().trim();

const commonEnv = (src: string, shared: SharedProps) => ({
  NODE_OPTIONS: '--enable-source-maps',
  PARAGEST_ENV: shared.env,
  // SENTRY_DSN: 'https://e36e8aa3d034861a3803d2edbd4773ff@o4504801902985216.ingest.sentry.io/4506375864254464',
  SENTRY_DSN: `http://e36e8aa3d034861a3803d2edbd4773ff@${shared.sentryDnsName}/sentry-relay/4506375864254464`,
  SENTRY_RELEASE: getGitSha(src),
  CONCURRENCY_TABLE_NAME: shared.concurrencyTable.tableName,
  NABU_DNS_NAME: shared.nabuDnsName,
  DYNAMODB_ENDPOINT: shared.dynamodbDnsName,
  SES_SMTP_SECRET_ARN: shared.sesSmtpSecret.secretArn,
});

export const genLambdaProps = (props: Pick<LambdaProps, 'src' | 'shared' | 'lambdaProps' | 'nodeModules'>): nodejs.NodejsFunctionProps => {
  const { src, nodeModules, shared } = props;
  const { environment = {}, ...lambdaProps } = props.lambdaProps ?? {};

  const entry = path.join('src', src);

  return {
    environment: {
      ...commonEnv(src, shared),
      ...environment,
    },
    runtime: lambda.Runtime.NODEJS_22_X,
    memorySize: 2048,
    ephemeralStorageSize: cdk.Size.gibibytes(10),
    timeout: cdk.Duration.seconds(120),

    ...lambdaProps,
    bundling: {
      format: nodejs.OutputFormat.ESM,
      target: 'esnext',
      mainFields: ['module', 'main'],
      // Dirty hack from https://github.com/evanw/esbuild/pull/2067
      banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      loader: {
        '.node': 'copy', // for sentry profiling library
      },
      sourceMap: true,
      minify: true,
      nodeModules: ['nodemailer', ...(nodeModules ?? [])],
      define: {
        'process.env.SENTRY_RELEASE': JSON.stringify(getGitSha(entry)),
      },
    },
    entry,
  };
};

export class LambdaStep extends Construct {
  public readonly func: lambda.Function;

  public readonly task: tasks.LambdaInvoke;

  constructor(scope: Construct, id: string, { grantFunc, ...props }: LambdaStepProps) {
    super(scope, id);

    const funcProps = genLambdaProps(props);
    this.func = new nodejs.NodejsFunction(this, `${id}StepLambda`, {
      ...funcProps,
      vpc: props.shared.vpc,
      vpcSubnets: { subnets: props.shared.subnets },
      filesystem: lambda.FileSystem.fromEfsAccessPoint(props.shared.accessPoint, '/mnt/efs'),
    });
    grantFunc?.(this.func);

    props.shared.concurrencyTable.grantReadWriteData(this.func);
    props.shared.sesSmtpSecret?.grantRead(this.func);

    this.task = new tasks.LambdaInvoke(this, `${id}StepTask`, {
      lambdaFunction: this.func,
      outputPath: '$.Payload',
    });
  }
}

type FargateStepProps = {
  src: string;
  taskProps?: Partial<tasks.LambdaInvokeProps>;
  grantFunc?: (jobRole: IRole) => void;
  jobProps?: Partial<tasks.BatchSubmitJobProps>;
  shared: SharedProps;
};

export class FargateStep extends Construct {
  public readonly task: tasks.BatchSubmitJob;

  constructor(scope: Construct, id: string, props: FargateStepProps) {
    super(scope, id);

    const { src, shared, jobProps, grantFunc } = props;

    const entry = path.join('src', src);

    const image = new ecrAssets.DockerImageAsset(this, `${id}StepDockerImage`, {
      directory: path.join(__dirname, '..', '..'),
      file: 'docker/fargate/Dockerfile',
      buildArgs: {
        SOURCE_FILE: entry,
      },
      extraHash: getGitSha(entry),
    });

    const jobRole = new iam.Role(this, `${id}JobRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const jobDef = new batch.EcsJobDefinition(this, `${id}JobDef`, {
      container: new batch.EcsFargateContainerDefinition(this, `${id}FargateContainer`, {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        memory: cdk.Size.gibibytes(32),
        cpu: 16,
        fargateCpuArchitecture: ecs.CpuArchitecture.X86_64,
        fargateOperatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        jobRole,
        volumes: [shared.volume],
      }),
    });

    this.task = new tasks.BatchSubmitJob(this, `${id}SubmitJob`, {
      jobDefinitionArn: jobDef.jobDefinitionArn,
      jobQueueArn: shared.jobQueue.jobQueueArn,
      jobName: `${id}Job`,
      containerOverrides: {
        environment: {
          ...commonEnv(src, shared),
          SFN_INPUT: sfn.JsonPath.jsonToString(sfn.JsonPath.stringAt('$')),
          SFN_TASK_TOKEN: sfn.JsonPath.taskToken,
        },
      },
      outputPath: '$',
      taskTimeout: sfn.Timeout.duration(cdk.Duration.minutes(15)),
      ...jobProps,
    });

    grantFunc?.(jobRole);

    shared.concurrencyTable.grantReadWriteData(jobRole);
    shared.volume.fileSystem.grantReadWrite(jobRole);
    shared.sesSmtpSecret?.grantRead(jobRole);

    jobRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure', 'states:SendTaskHeartbeat'],
        // TODO: Make this more specific
        resources: ['*'],
      }),
    );
  }
}
