import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ddb } from '../app/lib/dynamo'
import { GET as getSession, POST as postMessage } from '../app/api/sessions/[id]/route'
import { GET as listSessions, POST as createSession } from '../app/api/sessions/route'

// Route-level tests. They check the contract the frontend relies
// on, and that a session belonging to someone else is invisible.
// requireUser runs in local mode (see vitest.config.ts), so the
// current user is always "local-dev-user".

const ddbMock = mockClient(ddb)
const OWNER_PK = 'USER#local-dev-user'

function req(url = 'http://localhost/api/sessions', init?: RequestInit) {
  return new Request(url, init)
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  ddbMock.reset()
})

describe('GET /api/sessions', () => {
  it('returns the user sessions newest first', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { sessionId: 'old', title: 'Old', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { sessionId: 'new', title: 'New', createdAt: '2026-01-02', updatedAt: '2026-08-01' },
      ],
    })

    const res = await listSessions(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['new', 'old'])
    // The query must be scoped to this user's partition.
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input
    expect(input.ExpressionAttributeValues).toMatchObject({ ':pk': OWNER_PK })
  })
})

describe('POST /api/sessions', () => {
  it('creates a session owned by the current user', async () => {
    ddbMock.on(PutCommand).resolves({})

    const res = await createSession(req(undefined, { method: 'POST' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.session.sessionId).toMatch(/^session_/)
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<string, string>
    expect(item.PK).toBe(OWNER_PK)
    expect(item.SK).toBe(`SESSION#${body.session.sessionId}`)
  })
})

describe('GET /api/sessions/{id}', () => {
  it('404s when the session belongs to someone else', async () => {
    // A foreign session simply is not in this user's partition.
    ddbMock.on(GetCommand).resolves({})

    const res = await getSession(req(), params('someone-elses-session'))

    expect(res.status).toBe(404)
    // It must not go on to read messages.
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0)
  })

  it('returns messages oldest first for an owned session', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: OWNER_PK, SK: 'SESSION#s1', sessionId: 's1', title: 'T' },
    })
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { role: 'user', content: 'hi', createdAt: '2026-08-01T00:00:00Z' },
        { role: 'assistant', content: 'hello', createdAt: '2026-08-01T00:00:01Z' },
      ],
    })

    const res = await getSession(req(), params('s1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messages).toHaveLength(2)
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input
    expect(input.ScanIndexForward).toBe(true)
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':pk': `${OWNER_PK}#S#s1`,
    })
  })
})

describe('POST /api/sessions/{id}', () => {
  it('rejects an empty message', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: OWNER_PK, SK: 'SESSION#s1', sessionId: 's1', title: '新しいチャット' },
    })

    const res = await postMessage(
      req(undefined, { method: 'POST', body: JSON.stringify({ role: 'user', content: '  ' }) }),
      params('s1'),
    )

    expect(res.status).toBe(400)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('names an untitled session after the first user message', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: OWNER_PK, SK: 'SESSION#s1', sessionId: 's1', title: '新しいチャット' },
    })
    ddbMock.on(PutCommand).resolves({})
    ddbMock.on(UpdateCommand).resolves({})

    const res = await postMessage(
      req(undefined, {
        method: 'POST',
        body: JSON.stringify({ role: 'user', content: 'AI の新刊を探して' }),
      }),
      params('s1'),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.title).toBe('AI の新刊を探して')
  })

  it('keeps an existing title', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: OWNER_PK, SK: 'SESSION#s1', sessionId: 's1', title: 'Existing' },
    })
    ddbMock.on(PutCommand).resolves({})
    ddbMock.on(UpdateCommand).resolves({})

    const res = await postMessage(
      req(undefined, {
        method: 'POST',
        body: JSON.stringify({ role: 'user', content: 'another message' }),
      }),
      params('s1'),
    )

    expect((await res.json()).title).toBe('Existing')
  })

  it('404s for a session the user does not own', async () => {
    ddbMock.on(GetCommand).resolves({})

    const res = await postMessage(
      req(undefined, {
        method: 'POST',
        body: JSON.stringify({ role: 'user', content: 'hi' }),
      }),
      params('foreign'),
    )

    expect(res.status).toBe(404)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0)
  })
})
