# BookChecker Plus — Enhanced Next.js Frontend

This is a delta on top of the book's `bookchecker` app (chapter 13).
Base repo: https://github.com/minorun365/agentcore-book (MIT license).
Finish the book's hands-on first. Then apply this delta.

## What this adds

1. Multi-session UI. Sessions and messages persist in DynamoDB.
   A sidebar lists past chats. Reload keeps the history.
2. Stable AgentCore session id. The book makes a new id per tab.
   Here the id lives in DynamoDB. So AgentCore short-term memory
   survives a page reload. This is a real behavior improvement.
3. Robust SSE. The reader buffers partial lines across chunks.
   The book's loop can drop an event split across two chunks.
   Connection retry runs only before the first byte.
   After the first byte a retry could run a tool twice, so we stop
   and offer a "resume" button instead.
4. Rate limiting. A token bucket in DynamoDB. 10 prompts burst,
   refill 10 per minute per user. Optimistic locking handles
   two tabs racing.
5. Server-side auth. Every Route Handler verifies the Cognito
   access token with `aws-jwt-verify`. Ownership is encoded in
   DynamoDB keys, so cross-user reads are impossible by design.
6. Markdown with GFM tables and safe links.

## Architecture

```
Browser (React client components)
  |  Cognito access token (Bearer)
  |
  +--> AgentCore Runtime (direct, SSE stream)   ... unchanged from the book
  |
  +--> Next.js Route Handlers (Amplify Hosting compute)
         /api/set-token          ... book 13.4.4 (keep as is)
         /api/oauth2/callback    ... book 13.4.4 (keep as is)
         /api/rate-check         ... NEW: token bucket gate
         /api/sessions           ... NEW: list / create
         /api/sessions/{id}      ... NEW: history / append / delete
                |
                v
           DynamoDB (single table: bookchecker-app)
```

Design choice: the stream still goes browser -> AgentCore directly.
A proxy through Next.js would allow true resume with Last-Event-ID.
The cost is one extra hop and stream buffering on the server.
See "Extension" below. This tradeoff is good interview material.

## DynamoDB table

Single-table design. Ownership lives in the partition key.

| Item     | PK                       | SK                  |
|----------|--------------------------|---------------------|
| Session  | `USER#{sub}`             | `SESSION#{id}`      |
| Message  | `USER#{sub}#S#{id}`      | `MSG#{ts}#{rand}`   |
| Bucket   | `USER#{sub}`             | `RATE`              |

Access patterns:
- List sessions: Query PK = `USER#{sub}`, SK begins_with `SESSION#`
- Load history: Query PK = `USER#{sub}#S#{id}`, ascending
- Rate check: Get + conditional Put on the bucket item

Create it from your machine with CDK. The complete prerequisite,
review, deploy, and teardown procedure is in `AWS_SETUP.md`; the
environment-specific deploy commands are:

```bash
cd infra
npx cdk deploy -c env=dev --require-approval any-change
npx cdk deploy -c env=prod -c ssrRoleName=bookchecker-ssr-role --require-approval any-change
```

The stack also creates the least-privilege IAM policy and, when
you pass the role name, attaches it to the Amplify SSR compute
role from book 13.4.7. Stack outputs give you `TableName` and
`TableAccessPolicyArn`.

If you prefer to do it by hand, the equivalent CLI call and IAM
policy are below.

```bash
aws dynamodb create-table \
  --table-name bookchecker-app \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

## IAM

Attach this inline policy to `bookchecker-ssr-role`
(the SSR compute role from book 13.4.7).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/bookchecker-app"
    }
  ]
}
```

## Amplify environment variables

Add these in the Amplify console. Keep the existing ones.

| Key                    | Value                                  |
|------------------------|----------------------------------------|
| `DYNAMO_TABLE_NAME`    | `bookchecker-app`                      |
| `COGNITO_USER_POOL_ID` | User pool ID from book 13.4.6          |
| `COGNITO_CLIENT_ID`    | App client ID from book 13.4.6         |
| `AWS_REGION`           | `us-east-1` (usually set already)      |

Note: Amplify Hosting must expose these to SSR. If a variable
does not reach the server, add it to `amplify.yml` as an env
pass-through. Check the Amplify docs for your build image.

## Install new packages

The completed monorepo already has all JavaScript and Python
dependencies declared. Run from its root:

```bash
bun run setup
```

This installs the root Bun workspace and runs `uv sync` for the
Python agent. The local DynamoDB Docker/Podman and table creation
commands are in `LOCAL_DEV.md`.

For a fully local loop (no Cognito, no AgentCore runtime), see
`LOCAL_DEV.md`.

## File placement

Copy `app/` from this delta into the repo. It adds:

```
app/lib/verify-token.ts
app/lib/dynamo.ts
app/lib/rate-limit.ts
app/api/rate-check/route.ts
app/api/sessions/route.ts
app/api/sessions/[id]/route.ts
app/hooks/use-agent-stream.ts
app/components/markdown.tsx
app/components/sidebar.tsx
app/components/chat.tsx
app/lib/auth-token.ts       <- token helper (cloud + local mode)
app/auth-provider.tsx       <- picks Cognito or local mode
app/page.tsx                <- replaces the book's page.tsx
app/enhanced.css            <- new styles
compose.yml                 <- DynamoDB Local
compose.podman.yml          <- rootless Podman variant
agent/                      <- Python source + AgentCore config
package.json bun.lock       <- monorepo commands + JS lockfile
.oxfmtrc.json .oxlintrc.json .env.local.example
```

Then make two edits in `app/layout.tsx`:

```ts
import './enhanced.css';                              // add
import { AppAuthProvider } from './auth-provider';    // add
// ...
<AppAuthProvider>{children}</AppAuthProvider>         // replaces <AuthProvider>
```

`AppAuthProvider` uses the book's `providers.tsx` in cloud mode and
skips it in local mode, so keep `providers.tsx` unchanged. Also keep
`globals.css`, `api/set-token`, and `api/oauth2/callback` as they are.

Verified on 2026-08-22: `tsc --noEmit` (strict) clean,
`oxfmt --check` clean, `oxlint` 0 errors, 32 app tests and 8
infra tests passing. See `TESTING.md`.

## Interview talking points

- Single-table DynamoDB: access patterns first, keys second.
  Ownership by key construction removes an authz query.
- Token bucket: burst capacity vs steady rate. Optimistic
  locking with a version attribute. Fail-closed on contention.
- SSE at-most-once vs at-least-once: why retry stops after the
  first byte. Side effects (calendar write) make blind retry unsafe.
- Optimistic UI with rollback on 429.
- Stateless SSR compute: all state in DynamoDB, so Amplify can
  scale instances freely.

## Extension: true mid-stream resume

Current resume re-asks the agent. AgentCore short-term memory
recovers the context, but tokens already generated are lost on
the wire. For true resume:

1. Proxy the stream: browser -> Next.js Route Handler -> AgentCore.
2. The proxy assigns an event id to each SSE event and appends
   each event to DynamoDB (or ElastiCache) under the turn id.
3. On reconnect the client sends `Last-Event-ID`. The proxy
   replays stored events, then continues the live stream.

Tradeoffs: one more hop of latency, storage cost per turn,
and the proxy must handle backpressure. This maps directly to
"design a real-time delivery system" interview questions.
