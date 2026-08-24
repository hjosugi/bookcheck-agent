import { NextResponse } from 'next/server'
import { requireUser } from '../../lib/verify-token'
import { createSession, listSessions } from '../../lib/session-store'

// GET  /api/sessions  -> list the user's sessions, newest first
// POST /api/sessions  -> create a new session

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function GET(req: Request) {
  const user = await requireUser(req)
  if (!user) return unauthorized()

  return NextResponse.json({ sessions: await listSessions(user.sub) })
}

export async function POST(req: Request) {
  const user = await requireUser(req)
  if (!user) return unauthorized()

  return NextResponse.json({ session: await createSession(user.sub) })
}
