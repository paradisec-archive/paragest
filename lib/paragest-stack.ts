import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class ParagestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = props?.env?.account === '386274780754' ? 'stage' : 'prod';

    const bucket = new s3.Bucket(this, 'IngestBucket', {
      bucketName: `paragest-ingest-${env}`,
    });
    const startState = new sfn.Pass(this, 'StartState');
    const successState = new sfn.Pass(this, 'SuccessState');
    // const failureState = new sfn.Pass(this, 'FailureState');
    // const choice = new sfn.Choice(this, 'Did it work?');

    const checkCatalogForItem = new nodejs.NodejsFunction(this, 'CheckCatalogForItemLambda', {
      entry: 'src/checkCatalogForItem.ts',
    });
    const checkCatalogForItemStep = new tasks.LambdaInvoke(this, 'CheckDBForItemTask', {
      lambdaFunction: checkCatalogForItem,
      // Lambda's result is in the attribute `guid`
      // outputPath: '$.guid',
    });

    const definition = sfn.Chain
      .start(startState)
      .next(checkCatalogForItemStep)
      .next(successState);

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      stateMachineName: 'Paragest',
      timeout: cdk.Duration.hours(1), // TODO: Set a reasonable timeout once we know more
    });

    const processS3Event = new nodejs.NodejsFunction(this, 'ProcessS3EventLambda', {
      entry: 'src/processS3Event.ts',
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
    });

    const s3EventSource = new eventsources.S3EventSource(bucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: 'incoming/' }],
    });
    processS3Event.addEventSource(s3EventSource);

    stateMachine.grantStartExecution(processS3Event);
  }
}
