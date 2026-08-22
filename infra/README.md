# infra — AWS resources as code

CDK app that creates the DynamoDB table and IAM policy this delta
needs. Two environments (`dev`, `prod`) from one codebase.

Full instructions: `../AWS_SETUP.md`.

```
bin/app.ts                    entry point, reads -c env=dev|prod
lib/env-config.ts             the only place environments differ
lib/bookcheck-agent-stack.ts the stack
test/stack.test.ts            template assertions (offline)
```

```bash
bun install            # run once at repository root
bun run infra:test     # tests, no AWS calls
bun run infra:synth:dev
cd infra
bunx cdk diff -c env=prod
# Complete deployment procedure: ../AWS_SETUP.md
```

Versions verified on npm on 2026-08-22: aws-cdk-lib 2.266.0,
constructs 10.8.1, aws-cdk 2.1138.0, vitest 4.1.11.
