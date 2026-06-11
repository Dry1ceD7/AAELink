/**
 * Regression test for audit finding CRIT-003 (audit-2026-05-26).
 *
 * `lib/worker.ts` MUST NOT instantiate its own `pg.Pool`. The single source
 * of database pooling is `lib/db.ts#getPool()`. Two pools (one in db.ts and
 * one in worker.ts) doubled the connection footprint and the worker's pool
 * was never closed on graceful shutdown — connections leaked on every
 * redeploy until Postgres `max_connections` was exhausted.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Strip both `// line` and slash-star block comments from TypeScript source
 * so the regex assertions only inspect *executable* code. The pre-fix
 * comment text in `lib/worker.ts` literally contains the strings we
 * forbid (e.g. "Do NOT call pool.end() here"), which would otherwise
 * trigger false positives.
 */
function stripComments(src: string): string {
  // Remove block comments first (non-greedy across newlines), then line.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('lib/worker.ts — pool sourcing (CRIT-003)', () => {
  const workerSrcRaw = readFileSync(resolve(__dirname, '..', 'lib', 'infra', 'worker.ts'), 'utf8')
  const workerSrc = stripComments(workerSrcRaw)

  it('does not import `Pool` as a value from `pg`', () => {
    // Type-only `import type { Pool }` is fine; runtime `import { Pool }` is not.
    expect(workerSrc).not.toMatch(/^import\s*\{[^}]*\bPool\b[^}]*\}\s*from\s*'pg'/m)
  })

  it('does not call `new Pool(`', () => {
    expect(workerSrc).not.toMatch(/new\s+Pool\s*\(/)
  })

  it('imports getPool from lib/db', () => {
    expect(workerSrc).toMatch(/import\s*\{[^}]*\bgetPool\b[^}]*\}\s*from\s*['"]@\/lib\/infra\/db['"]/)
  })

  it('does not call pool.end() on the shared singleton', () => {
    // Closing the shared pool would poison the API routes co-located in the
    // same process. The pool drains naturally on process.exit().
    expect(workerSrc).not.toMatch(/\bpool\.end\s*\(\s*\)/)
  })
})
