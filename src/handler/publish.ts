import * as AWS from "aws-sdk";
import { PublishMessageRequest, PublishMessageResponse, MessageRecord } from "../common/model";
import { timestamp } from "../common/time";
import config from '../config/config';

const {
  MESSAGE_TABLE_NAME,
  TABLE_NAME,
} = process.env;

const saveMessage = async (connectionId: string, topic: string, message: string): Promise<number> => {
  const ddb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });
  const jitter: number = Math.random()/1000;
  const ts: number = timestamp() + jitter; // to avoid conflict the sortkey

  const item: MessageRecord = {
    topic,
    connectionId,
    data: message,
    created_at: ts,
    ttl: timestamp() + config.messageTtl,
  };
  await ddb.put({
    TableName: MESSAGE_TABLE_NAME!,
    ReturnValues: 'NONE',
    Item: item,
  }).promise();

  return ts;
}

const sendMessage = async (ts: number, topic: string, message: any, event: any): Promise<void> => {
  const ddb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });

  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
  });

  const connectionData = await ddb.query({
    TableName: TABLE_NAME!,
    ProjectionExpression: "connectionId",
    KeyConditionExpression: "topic = :topic",
    ExpressionAttributeValues: {
      ":topic": topic,
    },
  }).promise();

  const postCalls = connectionData.Items!.map(async ({ connectionId }) => {
    const response: PublishMessageResponse<any> = {
      data: message,
      created_at: ts,
      topic,
    };
    await apigwManagementApi.postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify(response),
    }).promise();
  });

  await Promise.all(postCalls);
}

export async function handler(event: any): Promise<any> {
  const connectionId = event.requestContext.connectionId;
  const payload: PublishMessageRequest<any> = JSON.parse(event.body);
  const topic = payload.topic;
  const data = payload.data;

  console.log(`on publish ${JSON.stringify(event)}`);

  try {
    const ts = await saveMessage(connectionId, topic, data);
    await sendMessage(ts, topic, data, event);
  } catch (e) {
    console.log(e);
    return { statusCode: 500, body: (e as any).stack };
  }

  return { statusCode: 200, };
}
