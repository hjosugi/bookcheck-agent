import type { RemovalPolicy } from 'aws-cdk-lib'
import { RemovalPolicy as Removal } from 'aws-cdk-lib'

// One place that defines how each environment differs.
// Everything else in the stack reads from here.

export type EnvName = 'dev' | 'prod'

export interface EnvConfig {
  name: EnvName
  // Resource names are suffixed so both environments can live in
  // the same account without colliding.
  tableName: string
  // Prod keeps data if the stack is deleted. Dev does not.
  removalPolicy: RemovalPolicy
  pointInTimeRecovery: boolean
  // Optional: the Amplify SSR compute role created in book 13.4.7.
  // When set, the stack attaches the table policy to it for you.
  ssrRoleName?: string
  // Days to keep chat sessions. TTL is applied to session items.
  sessionTtlDays: number
}

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    tableName: 'bookchecker-app-dev',
    removalPolicy: Removal.DESTROY,
    pointInTimeRecovery: false,
    sessionTtlDays: 7,
  },
  prod: {
    name: 'prod',
    tableName: 'bookchecker-app',
    removalPolicy: Removal.RETAIN,
    pointInTimeRecovery: true,
    sessionTtlDays: 90,
  },
}

export function resolveEnv(name: string | undefined): EnvConfig {
  if (name !== 'dev' && name !== 'prod') {
    throw new Error(`env must be "dev" or "prod", got: ${String(name)}`)
  }
  return ENVIRONMENTS[name]
}
