import { CloudAssembly } from 'aws-cdk-lib/cx-api'
import { afterAll } from 'vitest'

afterAll(CloudAssembly.cleanupTemporaryDirectories)
