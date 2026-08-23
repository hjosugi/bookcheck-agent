import { describe, expect, it, vi } from 'vitest'
import { verifyAccessToken } from '../app/lib/verify-token'

// The app is deployed from a public repository, so every Route Handler has
// to be safe for an anonymous visitor to hit. /api/set-token and
// /api/oauth2/callback used to take the cookie on trust; these tests pin
// the check that replaced it.
//
// The suite runs in local-auth mode (see vitest.config.mts), which is what
// lets a non-empty token through without Cognito. The empty-token case is
// the one that stays meaningful in every mode.

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(new Map()),
}))

describe('verifyAccessToken', () => {
  it('rejects a missing token even in local mode', async () => {
    expect(await verifyAccessToken('')).toBeNull()
  })

  it('resolves a user when a token is present', async () => {
    expect(await verifyAccessToken('local-dev-token')).toEqual({ sub: 'local-dev-user' })
  })
})

describe('POST /api/set-token', () => {
  it('rejects a body without a token', async () => {
    const { POST } = await import('../app/api/set-token/route')
    const res = await POST(
      new Request('http://localhost/api/set-token', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects an empty token instead of storing it', async () => {
    const { POST } = await import('../app/api/set-token/route')
    const res = await POST(
      new Request('http://localhost/api/set-token', {
        method: 'POST',
        body: JSON.stringify({ token: '' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/oauth2/callback', () => {
  it('refuses an anonymous visitor with no cookie', async () => {
    const { GET } = await import('../app/api/oauth2/callback/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/oauth2/callback?session_id=sess-1'))
    expect(res.status).toBe(401)
  })

  it('still rejects a missing session_id first', async () => {
    const { GET } = await import('../app/api/oauth2/callback/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/oauth2/callback'))
    expect(res.status).toBe(400)
  })
})
