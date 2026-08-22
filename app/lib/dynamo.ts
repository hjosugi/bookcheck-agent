import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Single-table design.
//
// Access patterns and keys:
//   1) List sessions of a user
//      PK = USER#{sub}          SK = SESSION#{sessionId}
//   2) List messages of a session (owned by the user)
//      PK = USER#{sub}#S#{sessionId}   SK = MSG#{sortKey}
//   3) Rate limit bucket of a user
//      PK = USER#{sub}          SK = RATE
//
// Ownership is encoded in the key. A user can never read
// another user's session because the sub is part of the PK.

// Local development uses DynamoDB Local (docker-compose).
// Set DYNAMO_ENDPOINT to switch. Credentials are dummy values
// because DynamoDB Local does not check them.
const endpoint = process.env.DYNAMO_ENDPOINT;

const localOptions = endpoint
  ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
  : undefined;

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...localOptions,
});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE = process.env.DYNAMO_TABLE_NAME ?? 'bookchecker-app';

export const keys = {
  userPk: (sub: string) => `USER#${sub}`,
  sessionSk: (sessionId: string) => `SESSION#${sessionId}`,
  messagesPk: (sub: string, sessionId: string) => `USER#${sub}#S#${sessionId}`,
  // Time-ordered sort key. Padded so string order equals time order.
  messageSk: () => `MSG#${String(Date.now()).padStart(14, '0')}#${crypto.randomUUID().slice(0, 8)}`,
  rateSk: () => 'RATE',
};

export interface SessionItem {
  PK: string;
  SK: string;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageItem {
  PK: string;
  SK: string;
  role: 'user' | 'assistant';
  content: string;
  // 'partial' marks an assistant message cut off by a network error.
  kind?: 'normal' | 'partial';
  createdAt: string;
}
