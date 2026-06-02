import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    /**
     * Default environment is node — every existing `*.test.ts` runs in pure
     * Node and that's deliberately preserved (1,357 tests rely on it).
     *
     * Component tests live in `*.test.tsx` and switch to `happy-dom` via the
     * `@vitest-environment happy-dom` docblock at the top of each test file
     * (Vitest 4 removed `environmentMatchGlobs`).
     */
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 15000,
    hookTimeout: 10000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['lib/**/*.ts'],
      exclude: ['lib/migrate.ts', 'lib/wsGateway/**', 'lib/worker.ts'],
      // v0.0.43 — start with conservative thresholds; bump in later releases
      // as more code lands behind tests.
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 45,
      },
      reporter: ['text', 'json-summary', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
