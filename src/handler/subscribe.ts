import * as AWS from "aws-sdk";
import { PublishMessageResponse, SubscribeMessageRequest, ConnectionRecord } from "../common/model";
import { timestamp } from '../common/time';
import config from '../config/config';

const {
    TABLE_NAME,
    MESSAGE_TABLE_NAME,
} = process.env;

const saveSubRecord = async (topic: string, connectionId: string): Promise<void> => {
  const ddb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });

  const item: ConnectionRecord = {
    topic,
    connectionId,
    ttl: timestamp() + config.connectionTtl,
  };
  await ddb.put({
    TableName: TABLE_NAME!,
    ReturnValues: 'NONE',
    Item: item,
  }).promise();
};

const sendUnreadMessages = async (topic: string, connectionId: string, last_created_at: number, event: any) => {
  const ddb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });
  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
  });

  const messages = await ddb.query({
    TableName: MESSAGE_TABLE_NAME!,
    KeyConditionExpression: 'topic = :topic AND created_at > :created_at',
    ExpressionAttributeValues: {
      ':topic': topic,
      ':created_at': last_created_at,
    },
  }).promise();

  const sendMessageTasks = messages.Items!.map(async message => {
    const response: PublishMessageResponse<any> = {
      data: message.data,
      created_at: message.created_at,
      topic,
    };
    await apigwManagementApi.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify(response),
    }).promise();
  });

  await Promise.all(sendMessageTasks);
}

export async function handler(event: any): Promise<any> {
  const connectionId: string = event.requestContext.connectionId;
  const payload: SubscribeMessageRequest = JSON.parse(event.body);
  let topic: string = payload.topic;

  if (!topic) {
    return { statusCode: 400, };
  }

  try {
    await saveSubRecord(topic, connectionId);

    if (payload.last_created_at != undefined){
      await sendUnreadMessages(topic, connectionId, payload.last_created_at, event);
    }
    return { statusCode: 200, };
  } catch(e) {
    console.log(e);
    return { statusCode: 500, };
  }
}
