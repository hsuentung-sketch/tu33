import { defineConfig } from 'vitest/config';

/**
 * Integration tests — hit a real Postgres at TEST_DATABASE_URL.
 * Run: npm run test:integration
 */
export default defineConfig({
  test: {
    globals: false,
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Run integration tests serially to avoid truncate races across files.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
