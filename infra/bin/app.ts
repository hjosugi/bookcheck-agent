#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { BookcheckAgentStack } from '../lib/bookcheck-agent-stack'
import { resolveEnv } from '../lib/env-config'

// Deploy one environment at a time:
//   bunx cdk deploy -c env=dev
//   bunx cdk deploy -c env=prod -c ssrRoleName=bookchecker-ssr-role

const app = new App()

const envName = app.node.tryGetContext('env') ?? 'dev'
const config = resolveEnv(envName)

// Optional override from the command line.
const ssrRoleName = app.node.tryGetContext('ssrRoleName')
if (ssrRoleName) config.ssrRoleName = ssrRoleName

new BookcheckAgentStack(app, `BookcheckAgent-${config.name}`, {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: `bookcheck-agent resources (${config.name})`,
  tags: { project: 'bookcheck-agent', environment: config.name },
})
