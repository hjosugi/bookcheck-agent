import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, TABLE, keys } from './dynamo'

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

const CAPACITY = 10
const REFILL_PER_SEC = 10 / 60 // 10 prompts per minute
const MAX_RETRY = 2

interface Bucket {
  PK: string
  SK: string
  tokens: number
  updatedAtMs: number
  version: number
}

export interface RateResult {
  allowed: boolean
  // Seconds until one token is available. Only set when denied.
  retryAfterSec?: number
  remaining: number
}

/** Tokens available now, after time-based refill. Capped at CAPACITY. */
function refill(bucket: Bucket | undefined, now: number): number {
  const prevTokens = bucket?.tokens ?? CAPACITY
  const elapsedSec = bucket ? (now - bucket.updatedAtMs) / 1000 : 0
  return Math.min(CAPACITY, prevTokens + elapsedSec * REFILL_PER_SEC)
}

/**
 * Optimistic lock: a first write must create the item, a later write must
 * still see the version it read.
 */
function guardedPut(next: Bucket, seen: Bucket | undefined) {
  return new PutCommand({
    TableName: TABLE,
    Item: next,
    ConditionExpression: seen ? 'version = :v' : 'attribute_not_exists(PK)',
    ExpressionAttributeValues: seen ? { ':v': seen.version } : undefined,
  })
}

export async function consumeToken(sub: string): Promise<RateResult> {
  const PK = keys.userPk(sub)
  const SK = keys.rateSk()

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const now = Date.now()

    const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK, SK } }))
    const cur = got.Item as Bucket | undefined

    const tokens = refill(cur, now)

    if (tokens < 1) {
      const waitSec = Math.ceil((1 - tokens) / REFILL_PER_SEC)
      return { allowed: false, retryAfterSec: waitSec, remaining: 0 }
    }

    const next: Bucket = {
      PK,
      SK,
      tokens: tokens - 1,
      updatedAtMs: now,
      version: (cur?.version ?? 0) + 1,
    }

    try {
      await ddb.send(guardedPut(next, cur))
      return { allowed: true, remaining: Math.floor(next.tokens) }
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'ConditionalCheckFailedException') continue // lost the race, retry
      throw err
    }
  }

  // Too much contention. Fail closed with a short wait.
  return { allowed: false, retryAfterSec: 3, remaining: 0 }
}
