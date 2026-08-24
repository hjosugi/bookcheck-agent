// Network calls the chat makes. Kept apart from the component so that
// sendPrompt reads as a sequence of steps rather than a wall of fetch().

import { getAuthToken } from './auth-token'

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  kind?: string
}

export type MessageKind = 'normal' | 'partial'

export async function loadHistory(sessionId: string): Promise<StoredMessage[]> {
  const token = await getAuthToken()
  const res = await fetch(`/api/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { messages: StoredMessage[] }
  return data.messages
}

export async function saveMessage(
  token: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  kind: MessageKind = 'normal',
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role, content, kind }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number }

/** One prompt costs one token. */
export async function consumeRateToken(token: string): Promise<RateLimitResult> {
  const res = await fetch('/api/rate-check', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status !== 429) return { allowed: true }
  const body = (await res.json()) as { retryAfterSec?: number }
  return { allowed: false, retryAfterSec: body.retryAfterSec ?? 5 }
}

/** Register the Cognito JWT for the 3LO callback (book 13.4.4). */
export async function registerAuthToken(token: string): Promise<void> {
  await fetch('/api/set-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {})
}
