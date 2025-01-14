import { Logger } from '@bitblit/ratchet/dist/common';
import AWS from 'aws-sdk';
import { GetQueueAttributesResult } from 'aws-sdk/clients/sqs';
import { Substitute } from '@fluffy-spoon/substitute';
import { ModelValidator } from '@bitblit/ratchet/dist/model-validator';
import { BackgroundManager } from './background-manager';
import { BackgroundConfig } from './config/background/background-config';
import { EchoProcessor } from './built-in/background/echo-processor';
import { NoOpProcessor } from './built-in/background/no-op-processor';

describe('#createEntry', function () {
  let mockSqs;
  let mockSns;
  let backgroundMgr: BackgroundManager;
  const fakeAccountNumber: string = '123456789012';
  let backgroundConfig: BackgroundConfig;
  const fakeModelValidator: ModelValidator = new ModelValidator({ BackgroundBuiltInSampleInputValidatedProcessor: {} });

  const echoProcessor: EchoProcessor = new EchoProcessor();
  const noOpProcessor: NoOpProcessor = new NoOpProcessor();

  beforeEach(() => {
    mockSqs = Substitute.for<AWS.SQS>();
    mockSns = Substitute.for<AWS.SNS>();

    backgroundConfig = {
      processors: [echoProcessor, noOpProcessor],
      httpSubmissionPath: '/background/',
      implyTypeFromPathSuffix: true,
      httpMetaEndpoint: '/background-meta',
      aws: {
        queueUrl: 'https://fake-sqs.fake-availability-zone.test.com/' + fakeAccountNumber + '/fakeQueue.fifo',
        notificationArn: 'arn:aws:sns:fake-availability-zone:' + fakeAccountNumber + ':fakeSnsTopicName',
      },
    };

    backgroundMgr = new BackgroundManager(backgroundConfig.aws, mockSqs, mockSns);
  });

  it('Should return queue attributes', async () => {
    mockSqs
      .getQueueAttributes({ AttributeNames: ['All'], QueueUrl: backgroundConfig.aws.queueUrl })
      .promise()
      .resolves({ Attributes: { ApproximateNumberOfMessages: 1 } });

    const queueAttr: GetQueueAttributesResult = await backgroundMgr.fetchCurrentQueueAttributes();
    const msgCount: number = await backgroundMgr.fetchApproximateNumberOfQueueEntries();
    Logger.info('Got : %j', queueAttr);
    Logger.info('Msg: %d', msgCount);
    expect(queueAttr).toBeTruthy();
    expect(msgCount).toEqual(1);
  });

  it('Should round-trip guids with prefix no slash', async () => {
    const prefix: string = 'test';
    const guid: string = BackgroundManager.generateBackgroundGuid();
    expect(guid).toBeTruthy();
    const path: string = BackgroundManager.backgroundGuidToPath(prefix, guid);
    const outGuid: string = BackgroundManager.pathToBackgroundGuid(prefix, path);
    expect(outGuid).toEqual(guid);
  });

  it('Should round-trip guids with prefix with slash', async () => {
    const prefix: string = 'test/';
    const guid: string = BackgroundManager.generateBackgroundGuid();
    expect(guid).toBeTruthy();
    const path: string = BackgroundManager.backgroundGuidToPath(prefix, guid);
    const outGuid: string = BackgroundManager.pathToBackgroundGuid(prefix, path);
    expect(outGuid).toEqual(guid);
  });

  it('Should round-trip guids with no prefix', async () => {
    const prefix: string = null;
    const guid: string = BackgroundManager.generateBackgroundGuid();
    expect(guid).toBeTruthy();
    const path: string = BackgroundManager.backgroundGuidToPath(prefix, guid);
    const outGuid: string = BackgroundManager.pathToBackgroundGuid(prefix, path);
    expect(outGuid).toEqual(guid);
  });
});
