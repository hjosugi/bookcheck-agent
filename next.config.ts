import type { NextConfig } from 'next'

// Keep a variable out of `env` entirely when the build has no value for it.
// Substituting an empty string instead would defeat the `??` fallbacks the
// callers rely on — `'' ?? 'default'` is `''`, so app/lib/dynamo.ts would end
// up querying a table with no name rather than its default one.
function forwardedEnv(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.flatMap(name => {
      const value = process.env[name]
      return value ? [[name, value]] : []
    }),
  )
}

const nextConfig: NextConfig = {
  // next dev/build writes AGENTS.md and CLAUDE.md at the repo root on every
  // run. They are generated files, so they are not kept in git.
  agentRules: false,

  env: forwardedEnv([
    'COGNITO_USER_POOL_ID',
    'COGNITO_CLIENT_ID',
    // Without this the Amplify variable was inert and app/lib/dynamo.ts silently
    // fell back to its default table name, which happened to be right.
    'DYNAMO_TABLE_NAME',
  ]),

  async rewrites() {
    return [
      {
        source: '/local-agent/:path*',
        destination: 'http://127.0.0.1:8080/:path*',
      },
    ]
  },
}

export default nextConfig
