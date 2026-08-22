import { describe, expect, it } from 'vitest';
import { keys } from '../app/lib/dynamo';
import { requireUser } from '../app/lib/verify-token';

// Ownership in this app is enforced by key construction, not by a
// permission check. So the key helpers are security code and get
// tested like security code.

describe('key helpers', () => {
  it('scopes sessions and messages to the user', () => {
    expect(keys.userPk('alice')).toBe('USER#alice');
    expect(keys.messagesPk('alice', 'sess-1')).toBe('USER#alice#S#sess-1');
  });

  it('gives two users disjoint partitions for the same session id', () => {
    const a = keys.messagesPk('alice', 'shared-id');
    const b = keys.messagesPk('bob', 'shared-id');
    expect(a).not.toBe(b);
  });

  it('sorts message keys in time order as strings', () => {
    // Padding is what makes string order equal time order.
    const early = `MSG#${String(1_000_000_000).padStart(14, '0')}#aaaaaaaa`;
    const late = `MSG#${String(2_000_000_000).padStart(14, '0')}#aaaaaaaa`;
    expect([late, early].toSorted()).toEqual([early, late]);
  });

  it('produces a message key with the expected shape', () => {
    const sk = keys.messageSk();
    expect(sk).toMatch(/^MSG#\d{14}#[0-9a-f]{8}$/);
  });

  it('keeps the rate bucket in the user partition', () => {
    expect(keys.rateSk()).toBe('RATE');
  });
});

describe('requireUser in local mode', () => {
  // The suite sets LOCAL_AUTH=1 and NODE_ENV=test in the vitest
  // config, which is the local-development combination.

  it('accepts a request without any Authorization header', async () => {
    const user = await requireUser(new Request('http://localhost/api/sessions'));
    expect(user).toEqual({ sub: 'local-dev-user' });
  });

  it('does not need Cognito environment variables', () => {
    expect(process.env.COGNITO_USER_POOL_ID).toBeUndefined();
    expect(process.env.COGNITO_CLIENT_ID).toBeUndefined();
  });
});
