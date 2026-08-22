import { NextResponse } from 'next/server';
import { requireUser } from '../../lib/verify-token';
import { consumeToken } from '../../lib/rate-limit';

// The client calls this once before each prompt.
// 200: one token consumed, the prompt may start.
// 429: over the limit. Retry-After tells the wait in seconds.

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await consumeToken(user.sub);
  if (!result.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec: result.retryAfterSec },
      {
        status: 429,
        headers: { 'Retry-After': String(result.retryAfterSec ?? 5) },
      },
    );
  }

  return NextResponse.json({ ok: true, remaining: result.remaining });
}
