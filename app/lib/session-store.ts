// DynamoDB access for chat sessions and their messages.
//
// Route handlers stay HTTP-shaped: authenticate, call one of these, and
// map the result to a response. The command building lives here.

import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { ddb, TABLE, keys, type SessionItem, type MessageItem } from './dynamo'

export const DEFAULT_TITLE = '新しいチャット'
const TITLE_MAX = 30
// DynamoDB rejects BatchWrite requests larger than this.
const BATCH_LIMIT = 25

export interface SessionSummary {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
}

const toSummary = ({ sessionId, title, createdAt, updatedAt }: SessionItem): SessionSummary => ({
  sessionId,
  title,
  createdAt,
  updatedAt,
})

export async function listSessions(sub: string): Promise<SessionSummary[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': keys.userPk(sub), ':sk': 'SESSION#' },
    }),
  )
  return ((res.Items ?? []) as SessionItem[])
    .map(toSummary)
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function createSession(sub: string): Promise<SessionSummary> {
  const now = new Date().toISOString()
  // Prefix so the id also works as the AgentCore session_id.
  const sessionId = `session_${crypto.randomUUID()}`

  const item: SessionItem = {
    PK: keys.userPk(sub),
    SK: keys.sessionSk(sessionId),
    sessionId,
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
  }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }))
  return toSummary(item)
}

// The sub is part of every key. A wrong user gets a 404, never data.
export async function getSessionMeta(sub: string, id: string): Promise<SessionItem | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: keys.userPk(sub), SK: keys.sessionSk(id) },
    }),
  )
  return (res.Item as SessionItem) ?? null
}

export async function listMessages(sub: string, id: string): Promise<MessageItem[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': keys.messagesPk(sub, id) },
      ScanIndexForward: true, // oldest first
    }),
  )
  return (res.Items ?? []) as MessageItem[]
}

export async function appendMessage(
  sub: string,
  id: string,
  message: Pick<MessageItem, 'role' | 'content' | 'kind'>,
  createdAt: string,
): Promise<void> {
  const item: MessageItem = {
    PK: keys.messagesPk(sub, id),
    SK: keys.messageSk(),
    role: message.role,
    content: message.content,
    kind: message.kind ?? 'normal',
    createdAt,
  }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }))
}

/** The first user message names the session; later ones leave it alone. */
export function nextTitle(current: string, role: 'user' | 'assistant', content: string): string {
  const isDefaultTitle = current === DEFAULT_TITLE
  return role === 'user' && isDefaultTitle ? content.slice(0, TITLE_MAX) : current
}

export async function touchSession(
  sub: string,
  id: string,
  title: string,
  updatedAt: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: keys.userPk(sub), SK: keys.sessionSk(id) },
      UpdateExpression: 'SET updatedAt = :u, title = :t',
      ExpressionAttributeValues: { ':u': updatedAt, ':t': title },
    }),
  )
}

async function deleteMessages(sub: string, id: string): Promise<void> {
  const PK = keys.messagesPk(sub, id)
  let lastKey: Record<string, unknown> | undefined

  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': PK },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
      }),
    )
    const items = page.Items ?? []
    for (let i = 0; i < items.length; i += BATCH_LIMIT) {
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: items.slice(i, i + BATCH_LIMIT).map(it => ({
              DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
            })),
          },
        }),
      )
    }
    lastKey = page.LastEvaluatedKey
  } while (lastKey)
}

/** Delete the session and every message under it. */
export async function deleteSession(sub: string, id: string): Promise<void> {
  await deleteMessages(sub, id)
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: keys.userPk(sub), SK: keys.sessionSk(id) },
    }),
  )
}
