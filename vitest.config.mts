import { defineConfig } from 'vitest/config';

// Tests run in local-auth mode so they never need Cognito.
// NODE_ENV stays "test", which is not "production", so the
// local-auth bypass is allowed here and refused in a real build.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      LOCAL_AUTH: '1',
      DYNAMO_TABLE_NAME: 'bookchecker-app-test',
      AWS_REGION: 'us-east-1',
    },
    coverage: {
      provider: 'v8',
      include: ['app/lib/**', 'app/hooks/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
