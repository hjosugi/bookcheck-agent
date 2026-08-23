import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { verifyAccessToken } from '../../lib/verify-token'

// Stores the caller's Cognito access token in an httpOnly cookie so the
// 3LO callback can identify the user (book 13.4.4).
//
// The token is verified before it is stored. Without that check any
// visitor could plant an arbitrary string here and have
// /api/oauth2/callback spend a CompleteResourceTokenAuth call on it.
export async function POST(request: Request) {
  const body = (await request.json()) as { token?: unknown }
  if (typeof body.token !== 'string' || !body.token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  const user = await verifyAccessToken(body.token)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cookieStore = await cookies()
  cookieStore.set('agentcore_user_token', body.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  })
  return NextResponse.json({ status: 'ok' })
}
