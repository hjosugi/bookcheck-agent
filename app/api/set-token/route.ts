import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = (await request.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set('agentcore_user_token', body.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  });
  return NextResponse.json({ status: 'ok' });
}
