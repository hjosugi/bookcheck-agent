import { NextResponse } from 'next/server'
import {
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  BatchWriteCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { requireUser } from '../../../lib/verify-token'
import { ddb, TABLE, keys, type SessionItem, type MessageItem } from '../../../lib/dynamo'

// GET    /api/sessions/{id} -> session meta + messages in order
// POST   /api/sessions/{id} -> append one message, update meta
// DELETE /api/sessions/{id} -> delete the session and its messages

type Params = { params: Promise<{ id: string }> }

// The sub is part of every key. A wrong user gets a 404, never data.
async function getMeta(sub: string, id: string): Promise<SessionItem | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: keys.userPk(sub), SK: keys.sessionSk(id) },
    }),
  )
  return (res.Item as SessionItem) ?? null
}

export async function GET(req: Request, { params }: Params) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const meta = await getMeta(user.sub, id)
  if (!meta) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': keys.messagesPk(user.sub, id) },
      ScanIndexForward: true, // oldest first
    }),
  )

  const messages = ((res.Items ?? []) as MessageItem[]).map(
    ({ role, content, kind, createdAt }) => ({ role, content, kind, createdAt }),
  )

  return NextResponse.json({
    session: { sessionId: meta.sessionId, title: meta.title },
    messages,
  })
}

export async function POST(req: Request, { params }: Params) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const meta = await getMeta(user.sub, id)
  if (!meta) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json()) as {
    role: 'user' | 'assistant'
    content: string
    kind?: 'normal' | 'partial'
  }
  if (!body.content?.trim() || (body.role !== 'user' && body.role !== 'assistant')) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const item: MessageItem = {
    PK: keys.messagesPk(user.sub, id),
    SK: keys.messageSk(),
    role: body.role,
    content: body.content,
    kind: body.kind ?? 'normal',
    createdAt: now,
  }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }))

  // Update meta. Set the title from the first user message.
  const isDefaultTitle = meta.title === '新しいチャット'
  const newTitle = body.role === 'user' && isDefaultTitle ? body.content.slice(0, 30) : meta.title
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: keys.userPk(user.sub), SK: keys.sessionSk(id) },
      UpdateExpression: 'SET updatedAt = :u, title = :t',
      ExpressionAttributeValues: { ':u': now, ':t': newTitle },
    }),
  )

  return NextResponse.json({ ok: true, title: newTitle })
}

export async function DELETE(req: Request, { params }: Params) {
  const user = await requireUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const meta = await getMeta(user.sub, id)
  if (!meta) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Delete messages in batches of 25 (BatchWrite limit).
  const msgPk = keys.messagesPk(user.sub, id)
  let lastKey: Record<string, unknown> | undefined
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': msgPk },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
      }),
    )
    const items = page.Items ?? []
    for (let i = 0; i < items.length; i += 25) {
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: items.slice(i, i + 25).map(it => ({
              DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
            })),
          },
        }),
      )
    }
    lastKey = page.LastEvaluatedKey
  } while (lastKey)

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: keys.userPk(user.sub), SK: keys.sessionSk(id) },
    }),
  )

  return NextResponse.json({ ok: true })
}
