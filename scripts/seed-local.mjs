// Seed DynamoDB Local with browsable chat data.
//
// Idempotent: every run first deletes the messages under the seeded session
// ids, then writes them fresh. Message sort keys embed a timestamp, so
// overwriting alone would not be enough. Data outside these ids is untouched.
//
//   pnpm run seed:local

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'

const endpoint = process.env.DYNAMO_ENDPOINT
const table = process.env.DYNAMO_TABLE_NAME ?? 'bookchecker-app'

// Guard: this script must never reach a real account.
if (!endpoint || !/^https?:\/\/(127\.0\.0\.1|localhost):/.test(endpoint)) {
  console.error(
    `DYNAMO_ENDPOINT must point at DynamoDB Local, got: ${endpoint ?? '(unset)'}\n` +
      'Run it as `pnpm run seed:local`, which loads .env.local.',
  )
  process.exit(1)
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint,
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
  { marshallOptions: { removeUndefinedValues: true } },
)

// LOCAL_AUTH=1 signs every request in as this user.
const SUB = 'local-dev-user'
const userPk = `USER#${SUB}`
const day = n => new Date(Date.now() - n * 86_400_000)

// Message sort keys must stay time-ordered as strings, like keys.messageSk().
const msgSk = (at, i) =>
  `MSG#${String(at.getTime()).padStart(14, '0')}#seed${String(i).padStart(4, '0')}`

const SESSIONS = [
  {
    id: 'session_seed00000001',
    title: 'AI関連の新刊ある？',
    daysAgo: 0,
    messages: [
      { role: 'user', content: 'AI関連の新刊ある？' },
      {
        role: 'assistant',
        content:
          'PC/IT書籍から3冊です。\n\n' +
          '- この1冊でしっかりわかる ChatGPTの教科書（2026年9月19日）\n' +
          '- イラスト図解式 この一冊で全部わかるAI技術の基本（2026年9月19日）\n' +
          '- 機械学習のエッセンス 第2版（2026年9月27日）',
      },
    ],
  },
  {
    id: 'session_seed00000002',
    title: 'Claudeの教科書をカレンダーに登録して',
    daysAgo: 1,
    messages: [
      { role: 'user', content: 'Claudeの教科書をカレンダーに登録して' },
      {
        role: 'assistant',
        content:
          'この1冊でしっかりわかる Claudeの教科書、発売日は2026年8月26日（水）です。この日付で終日予定を登録しますか？',
      },
      { role: 'user', content: 'お願いします' },
      {
        role: 'assistant',
        content: 'カレンダーに登録しました: この1冊でしっかりわかる Claudeの教科書 (2026-08-26)',
      },
    ],
  },
  {
    id: 'session_seed00000003',
    title: '半導体の本を探して',
    daysAgo: 3,
    messages: [
      { role: 'user', content: '半導体の本を探して' },
      // kind 'partial' renders with the 中断 tag and offers a resume.
      {
        role: 'assistant',
        content: '図解で深掘る　きちんとわかる　半導体（2026年8月27日）が該当します。内容',
        kind: 'partial',
      },
    ],
  },
]

/** Remove what a previous run wrote for this session. */
async function clearSeededMessages(sessionId) {
  const PK = `${userPk}#S#${sessionId}`
  const found = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': PK },
      ProjectionExpression: 'PK, SK',
    }),
  )
  const items = found.Items ?? []
  if (items.length === 0) return 0

  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: items.slice(i, i + 25).map(it => ({
            DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
          })),
        },
      }),
    )
  }
  return items.length
}

let written = 0
let removed = 0

for (const session of SESSIONS) {
  removed += await clearSeededMessages(session.id)
  const created = day(session.daysAgo)
  const last = new Date(created.getTime() + session.messages.length * 2000)

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: userPk,
        SK: `SESSION#${session.id}`,
        sessionId: session.id,
        title: session.title,
        createdAt: created.toISOString(),
        updatedAt: last.toISOString(),
      },
    }),
  )
  written++

  for (const [i, message] of session.messages.entries()) {
    const at = new Date(created.getTime() + i * 2000)
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `${userPk}#S#${session.id}`,
          SK: msgSk(at, i),
          role: message.role,
          content: message.content,
          kind: message.kind ?? 'normal',
          createdAt: at.toISOString(),
        },
      }),
    )
    written++
  }
}

// A full bucket, so seeded data never starts you off rate limited.
await ddb.send(
  new PutCommand({
    TableName: table,
    Item: { PK: userPk, SK: 'RATE', tokens: 10, updatedAtMs: Date.now(), version: 1 },
  }),
)
written++

if (removed > 0) console.log(`removed ${removed} items from a previous run`)
console.log(`seeded ${written} items into ${table} at ${endpoint}`)
console.log(`sessions: ${SESSIONS.length} (user: ${SUB})`)
