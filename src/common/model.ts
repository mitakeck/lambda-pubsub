/************************
 * client <-> lambda dto interface
 ***********************/

 export interface PublishMessageResponse<T> {
  topic: string;
  created_at: number;
  data: T;
}

export interface PublishMessageRequest<T> {
  action: 'publish',
  topic: string;
  data: T;
}

export interface SubscribeMessageRequest {
  action: 'subscribe',
  topic: string;
  last_created_at?: number,
}

/************************
 * dynamodb record
 ***********************/

export interface ConnectionRecord {
  connectionId: string;
  topic: string;
  ttl: number;
}

export interface MessageRecord {
  created_at: number;
  data: any;
  topic: string;
  connectionId: string;
  ttl: number;
}
