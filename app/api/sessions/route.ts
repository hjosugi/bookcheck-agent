import { NextResponse } from 'next/server';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { requireUser } from '../../lib/verify-token';
import { ddb, TABLE, keys, type SessionItem } from '../../lib/dynamo';

// GET  /api/sessions  -> list the user's sessions, newest first
// POST /api/sessions  -> create a new session

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': keys.userPk(user.sub),
        ':sk': 'SESSION#',
      },
    }),
  );

  const sessions = ((res.Items ?? []) as SessionItem[])
    .map(({ sessionId, title, createdAt, updatedAt }) => ({
      sessionId,
      title,
      createdAt,
      updatedAt,
    }))
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date().toISOString();
  // Prefix so the id also works as the AgentCore session_id.
  const sessionId = `session_${crypto.randomUUID()}`;

  const item: SessionItem = {
    PK: keys.userPk(user.sub),
    SK: keys.sessionSk(sessionId),
    sessionId,
    title: '新しいチャット',
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

  return NextResponse.json({
    session: { sessionId, title: item.title, createdAt: now, updatedAt: now },
  });
}
