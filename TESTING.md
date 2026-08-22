# TESTING.md

Two suites. Both run offline, in seconds, with no AWS calls.

```bash
bun run test          # app tests
bun run infra:test    # infra tests
```

## App tests (`test/`, vitest)

| File | Covers |
|---|---|
| `rate-limit.test.ts` | token bucket: refill, capacity cap, optimistic locking, race retry, fail-closed |
| `use-agent-stream.test.ts` | SSE parsing across chunk boundaries, retry policy, URL building |
| `sessions-api.test.ts` | Route Handlers: ownership isolation, ordering, validation, titling |
| `keys-and-auth.test.ts` | key construction (this is the authorization model), local-auth mode |

DynamoDB is mocked with `aws-sdk-client-mock`, so the tests assert
the exact commands sent, not just the return values. That is how
`ConditionExpression` and partition scoping stay correct.

Tests run with `LOCAL_AUTH=1` and `NODE_ENV=test` (set in
`vitest.config.mts`), so no Cognito configuration is needed.

## What the tests are actually protecting

Three behaviours in this codebase are easy to break silently, so
each has a test that fails loudly when it regresses.

1. **SSE line buffering.** An event split across two network
   chunks must still be parsed. The book's simpler reader drops
   it. `joins an event that is split across two chunks` fails if
   the buffer is removed.
2. **Retry only before the first byte.** After output has been
   emitted, a blind reconnect could run the calendar tool twice.
   `does NOT retry once output has been emitted` pins this.
3. **Ownership by key construction.** There is no separate
   permission check; the user id is part of the partition key.
   `404s when the session belongs to someone else` and the key
   tests guard it.

These were verified by mutation testing: breaking the buffering
and removing the capacity cap each produced exactly one failing
test, and no more.

## Infra tests (`infra/test/`, vitest + CDK assertions)

Synthesizes the stack in memory and asserts the template:

- one on-demand table with the `PK`/`SK` composite key and TTL
- prod: `DeletionPolicy: Retain` and point-in-time recovery on
- dev: `DeletionPolicy: Delete`
- the IAM policy lists exactly six actions and never a `*`
- the SSR role is attached only when a role name is supplied
- both outputs are present

No AWS credentials are needed. The first test takes ~5 s because
CDK loads its construct tree; the rest are instant.

## Not covered (on purpose)

- React components. The logic worth testing was moved out of them
  (`use-agent-stream.ts`, `lib/`), which is why those files exist.
- Anything that needs the real AgentCore runtime or Bedrock.
  That is what `LOCAL_DEV.md` manual verification is for.

If you add component tests later, use `@testing-library/react`
with `environment: 'jsdom'` in a second vitest project so the
node-environment suites stay fast.

## CI

`bun run check` runs format, lint, typecheck, and tests in one
command. Wire that into GitHub Actions with the infra suite:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
- run: bun run check
```
