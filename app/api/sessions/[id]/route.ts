import { NextResponse } from 'next/server'
import { requireUser } from '../../../lib/verify-token'
import {
  appendMessage,
  deleteSession,
  getSessionMeta,
  listMessages,
  nextTitle,
  touchSession,
} from '../../../lib/session-store'
import type { SessionItem } from '../../../lib/dynamo'

// GET    /api/sessions/{id} -> session meta + messages in order
// POST   /api/sessions/{id} -> append one message, update meta
// DELETE /api/sessions/{id} -> delete the session and its messages

type Params = { params: Promise<{ id: string }> }

interface MessageBody {
  role: 'user' | 'assistant'
  content: string
  kind?: 'normal' | 'partial'
}

type Resolved =
  | { ok: false; response: NextResponse }
  | { ok: true; sub: string; id: string; meta: SessionItem }

/** Authenticate, then confirm the session belongs to the caller. */
async function resolveSession(req: Request, params: Params['params']): Promise<Resolved> {
  const user = await requireUser(req)
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }

  const { id } = await params
  const meta = await getSessionMeta(user.sub, id)
  if (!meta) {
    return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  }

  return { ok: true, sub: user.sub, id, meta }
}

function parseMessageBody(raw: unknown): MessageBody | null {
  const body = raw as MessageBody | null
  if (!body?.content?.trim()) return null
  if (body.role !== 'user' && body.role !== 'assistant') return null
  return body
}

export async function GET(req: Request, { params }: Params) {
  const found = await resolveSession(req, params)
  if (!found.ok) return found.response

  const messages = (await listMessages(found.sub, found.id)).map(
    ({ role, content, kind, createdAt }) => ({ role, content, kind, createdAt }),
  )

  return NextResponse.json({
    session: { sessionId: found.meta.sessionId, title: found.meta.title },
    messages,
  })
}

export async function POST(req: Request, { params }: Params) {
  const found = await resolveSession(req, params)
  if (!found.ok) return found.response

  const body = parseMessageBody(await req.json())
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const now = new Date().toISOString()
  await appendMessage(found.sub, found.id, body, now)

  const title = nextTitle(found.meta.title, body.role, body.content)
  await touchSession(found.sub, found.id, title, now)

  return NextResponse.json({ ok: true, title })
}

export async function DELETE(req: Request, { params }: Params) {
  const found = await resolveSession(req, params)
  if (!found.ok) return found.response

  await deleteSession(found.sub, found.id)
  return NextResponse.json({ ok: true })
}
