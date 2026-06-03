import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Integration test config — the DB-backed suite under `__tests__/`.
 *
 * The default `vitest.config.ts` includes only `tests/**` (pure-Node unit
 * tests). The `__tests__/api/*` suite needs a live Postgres
 * (DATABASE_URL / TEST_DATABASE_URL) and is run separately via
 * `bun run test:integration`. A prior `--dir __tests__` invocation silently
 * matched nothing because the include glob still resolved against the root,
 * so this config makes the integration include explicit.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: ['default'],
    // Integration tests share one Postgres. Run files sequentially so
    // cross-file fixtures (orgs, workspaces, global tables like
    // information_barriers) can't collide and make assertions flaky.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
