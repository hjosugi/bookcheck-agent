import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ddb } from '../app/lib/dynamo'
import { consumeToken } from '../app/lib/rate-limit'

// The limiter is the piece most likely to break quietly, so the
// tests pin down the maths, the refill, and the race handling.

const ddbMock = mockClient(ddb)

// Capacity 10, refill 10 per minute (one token every 6 seconds).
const REFILL_MS_PER_TOKEN = 6000

beforeEach(() => {
  ddbMock.reset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-22T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('consumeToken', () => {
  it('allows the first request and creates the bucket', async () => {
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})

    const result = await consumeToken('user-1')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input
    // A brand new bucket must not overwrite an existing one.
    expect(put.ConditionExpression).toBe('attribute_not_exists(PK)')
    expect(put.Item).toMatchObject({ PK: 'USER#user-1', SK: 'RATE', version: 1 })
  })

  it('denies when the bucket is empty and reports the wait', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'USER#u', SK: 'RATE', tokens: 0, updatedAtMs: Date.now(), version: 4 },
    })

    const result = await consumeToken('u')

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    // One token takes 6 seconds to refill.
    expect(result.retryAfterSec).toBe(6)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0)
  })

  it('refills over time and allows again', async () => {
    const emptiedAt = Date.now()
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'USER#u', SK: 'RATE', tokens: 0, updatedAtMs: emptiedAt, version: 4 },
    })
    ddbMock.on(PutCommand).resolves({})

    vi.setSystemTime(emptiedAt + REFILL_MS_PER_TOKEN)
    const result = await consumeToken('u')

    expect(result.allowed).toBe(true)
  })

  it('never refills past capacity', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'USER#u',
        SK: 'RATE',
        tokens: 10,
        // Idle for a day. Without a cap this would be a huge burst.
        updatedAtMs: Date.now() - 24 * 60 * 60 * 1000,
        version: 9,
      },
    })
    ddbMock.on(PutCommand).resolves({})

    const result = await consumeToken('u')

    expect(result.remaining).toBe(9)
  })

  it('guards the write with the version it read', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'USER#u', SK: 'RATE', tokens: 5, updatedAtMs: Date.now(), version: 7 },
    })
    ddbMock.on(PutCommand).resolves({})

    await consumeToken('u')

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input
    expect(put.ConditionExpression).toBe('version = :v')
    expect(put.ExpressionAttributeValues).toEqual({ ':v': 7 })
    expect((put.Item as { version: number }).version).toBe(8)
  })

  it('retries once when another tab wins the race', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'USER#u', SK: 'RATE', tokens: 5, updatedAtMs: Date.now(), version: 7 },
    })
    const conflict = Object.assign(new Error('conflict'), {
      name: 'ConditionalCheckFailedException',
    })
    ddbMock.on(PutCommand).rejectsOnce(conflict).resolves({})

    const result = await consumeToken('u')

    expect(result.allowed).toBe(true)
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(2)
  })

  it('fails closed after too much contention', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK: 'USER#u', SK: 'RATE', tokens: 5, updatedAtMs: Date.now(), version: 7 },
    })
    const conflict = Object.assign(new Error('conflict'), {
      name: 'ConditionalCheckFailedException',
    })
    ddbMock.on(PutCommand).rejects(conflict)

    const result = await consumeToken('u')

    expect(result.allowed).toBe(false)
    expect(result.retryAfterSec).toBe(3)
  })

  it('rethrows errors that are not conflicts', async () => {
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).rejects(new Error('network down'))

    await expect(consumeToken('u')).rejects.toThrow('network down')
  })
})
