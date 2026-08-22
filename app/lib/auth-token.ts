'use client';

import { fetchAuthSession } from 'aws-amplify/auth';

// One place to get the token the API and the agent need.
//
// Cloud mode: the Cognito access token.
// Local mode: a placeholder string. The Route Handlers accept it
// because they run with LOCAL_AUTH=1. Never enabled in a
// production build (see app/lib/verify-token.ts).

export const LOCAL_AUTH = process.env.NEXT_PUBLIC_LOCAL_AUTH === '1';

const LOCAL_TOKEN = 'local-dev-token';

export async function getAuthToken(): Promise<string> {
  if (LOCAL_AUTH) return LOCAL_TOKEN;

  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error('no token');
  return token;
}

// AgentCore Memory uses actor_id as its user boundary. Decode the
// already verified Cognito subject so long-term memory is not shared
// between users. The server still performs the authoritative JWT check.
export function actorIdFromToken(token: string): string {
  if (LOCAL_AUTH) return 'local-dev-user';
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return 'unknown-user';
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : 'unknown-user';
  } catch {
    return 'unknown-user';
  }
}
