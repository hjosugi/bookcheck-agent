# AgentCore CDK Project

This CDK project is managed by the AgentCore CLI. It deploys your agent infrastructure into AWS using the `@aws/agentcore-cdk` L3 constructs.

## Structure

- `bin/cdk.ts` — Entry point. Reads project configuration from `agentcore/` and creates a stack per deployment target.
- `lib/cdk-stack.ts` — Defines `AgentCoreStack`, which wraps the `AgentCoreApplication` L3 construct.
- `test/cdk.test.ts` — Unit tests for stack synthesis.

## Useful commands

- `npm run build` compile TypeScript to JavaScript
- `npm run test` run unit tests with Vitest
- `npm run test:watch` run Vitest in watch mode
- `npm run format` format the project with Oxfmt
- `npm run lint` lint the project with Oxlint
- `npm run check` run formatting, linting, build, and tests
- `npx cdk synth` emit the synthesized CloudFormation template
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state

**This directory is the one place in the repository that is not on pnpm.**

The rest of the repo uses pnpm (`pnpm-workspace.yaml` at the root). This directory
is deliberately left out of that workspace: `@aws/agentcore` 0.27.1 hard-codes
`npm install` here when it synchronizes its managed dependencies, with no package
manager detection. Putting pnpm in charge would leave two lockfiles fighting and
have the CLI's npm install overwrite pnpm's layout on every deploy.

So: keep using npm here, and keep `package-lock.json` committed. Revisit when the
CLI lets you choose a package manager.

## Usage

You typically don't need to interact with this directory directly. The AgentCore CLI handles synthesis and deployment:

```bash
agentcore deploy    # synthesizes and deploys via CDK
agentcore status    # checks deployment status
```
