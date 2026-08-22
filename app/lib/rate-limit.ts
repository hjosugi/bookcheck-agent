import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE, keys } from './dynamo';

// Token bucket rate limiter.
//
// Each user has one bucket item in DynamoDB.
// The bucket holds up to CAPACITY tokens.
// Tokens refill at REFILL_PER_SEC while time passes.
// One prompt costs one token.
//
// Concurrency: two tabs can consume at the same time.
// We use optimistic locking. The write has a condition on
// the last seen version. On conflict we re-read and retry.

const CAPACITY = 10;
const REFILL_PER_SEC = 10 / 60; // 10 prompts per minute
const MAX_RETRY = 2;

interface Bucket {
  PK: string;
  SK: string;
  tokens: number;
  updatedAtMs: number;
  version: number;
}

export interface RateResult {
  allowed: boolean;
  // Seconds until one token is available. Only set when denied.
  retryAfterSec?: number;
  remaining: number;
}

export async function consumeToken(sub: string): Promise<RateResult> {
  const PK = keys.userPk(sub);
  const SK = keys.rateSk();

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const now = Date.now();

    const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK } }));
    const cur = got.Item as Bucket | undefined;

    // Refill based on elapsed time. Cap at CAPACITY.
    const prevTokens = cur?.tokens ?? CAPACITY;
    const elapsedSec = cur ? (now - cur.updatedAtMs) / 1000 : 0;
    const tokens = Math.min(CAPACITY, prevTokens + elapsedSec * REFILL_PER_SEC);

    if (tokens < 1) {
      const waitSec = Math.ceil((1 - tokens) / REFILL_PER_SEC);
      return { allowed: false, retryAfterSec: waitSec, remaining: 0 };
    }

    const next: Bucket = {
      PK,
      SK,
      tokens: tokens - 1,
      updatedAtMs: now,
      version: (cur?.version ?? 0) + 1,
    };

    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: next,
          // First write: the item must not exist.
          // Later writes: the version must match what we read.
          ConditionExpression: cur ? 'version = :v' : 'attribute_not_exists(PK)',
          ExpressionAttributeValues: cur ? { ':v': cur.version } : undefined,
        }),
      );
      return { allowed: true, remaining: Math.floor(next.tokens) };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'ConditionalCheckFailedException') continue; // lost the race, retry
      throw err;
    }
  }

  // Too much contention. Fail closed with a short wait.
  return { allowed: false, retryAfterSec: 3, remaining: 0 };
}
