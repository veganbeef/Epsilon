import { SNSEvent } from 'aws-lambda';
import { Substitute } from '@fluffy-spoon/substitute';
import AWS from 'aws-sdk';
import { InterApiUtil } from './inter-api-util';

describe('#interApiUtil', function () {
  let mockSns;

  beforeEach(() => {
    mockSns = Substitute.for<AWS.SNS>();
  });

  it('should verify that an event is an inter-api even', async () => {
    const evt: SNSEvent = {
      Records: [
        {
          EventSource: 'aws:sns',
          EventVersion: '1.0',
          EventSubscriptionArn: 'arn:aws:sns:us-east-1:012345678901:GenericApiEventTopicDev:6efec6a5-1f02-4fc5-b0f7-fa7c013cf8bb',
          Sns: {
            Type: 'Notification',
            MessageId: '205de1e8-7ba6-52f5-b706-b815f442c512',
            TopicArn: 'arn:aws:sns:us-east-1:012345678901:GenericApiEventTopicDev',
            Subject: null,
            Message:
              '{"type":"EPSILON_INTER_API_EVENT","interApiEvent":{"source":"OriginalApi","type":"Sample","data":{"notes":"SOURCE API: OriginalApi","timestampEpochMS":1636011428200}}}',
            Timestamp: '2021-11-04T07:37:08.241Z',
            SignatureVersion: '1',
            Signature: 'LyS2ybM/Epsq5sFqPJd==',
            SigningCertUrl: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-7ff5318490ec183fbaddaa2a969abfda.pem',
            UnsubscribeUrl:
              'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:012345678901:GenericApiEventTopicDev:6efec6a5-1f02-4fc5-b0f7-fa7c013cf8bb',
            MessageAttributes: {},
          },
        },
      ],
    };

    const res: boolean = InterApiUtil.isInterApiSnsEvent(evt);
    expect(res).toBeTruthy();
  }, 500);
});
