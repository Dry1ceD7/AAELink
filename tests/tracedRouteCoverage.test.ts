/**
 * IMP-001 reinforcement (audit-2026-05-26).
 *
 * Every `app/api/**\/route.ts` MUST funnel its HTTP-verb exports through
 * `tracedRoute()` from `lib/tracedRoute.ts`. The wrapper is the single
 * chokepoint that adds tracing, CSRF verification, and audit-log writes
 * to a 237-route surface — bypassing it for "just a quick GET" silently
 * disables those guarantees on the affected route.
 *
 * The 2026-05-19 audit found 1 untraced route. The 2026-05-26 audit
 * fixed it (CRIT-002 — `app/api/admin/prometheus/route.ts`). This test
 * locks the contract going forward.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = resolve(__dirname, '..')
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const

function listRouteFiles(): string[] {
  // POSIX find — avoids fd/rg flag aliasing.
  const out = execSync('/usr/bin/find app/api -name route.ts -type f', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Strip block + line comments so we only inspect executable code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/**
 * Find verb exports that bypass tracedRoute. The AAELink convention is:
 *   async function _VERB(req) { ... }                       // internal
 *   export const VERB = tracedRoute('VERB', '...', _VERB)   // exported
 *
 * A file is non-compliant when it contains either of:
 *   export [async] function VERB(...)        // bare function export
 *   export const VERB = ...                  // const export whose RHS line
 *                                            //   does not call tracedRoute(
 *
 * Comments are stripped first so doc strings like "GET — admin route"
 * don't trigger false positives.
 */
function offendersInFile(src: string, rel: string): string[] {
  const stripped = stripComments(src)
  const lines = stripped.split('\n')
  const found: string[] = []
  for (const line of lines) {
    for (const v of VERBS) {
      // Bare function export: `export [async] function VERB(`
      const fnRe = new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+${v}\\s*\\(`)
      if (fnRe.test(line)) {
        found.push(`${rel} :: ${v}`)
        continue
      }
      // Const export: `export const VERB =` ... and the same line must call
      // tracedRoute(. If the RHS spans multiple lines (rare; the codebase
      // keeps it on one line), this check is conservative.
      const constRe = new RegExp(`^\\s*export\\s+const\\s+${v}\\s*=`)
      if (constRe.test(line) && !line.includes('tracedRoute(')) {
        found.push(`${rel} :: ${v}`)
      }
    }
  }
  return found
}

describe('app/api/**/route.ts — tracedRoute coverage (IMP-001)', () => {
  const routeFiles = listRouteFiles()

  it('finds at least 100 route files (sanity check)', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(100)
  })

  it('every route.ts that exports a verb does so via tracedRoute()', () => {
    const offenders: string[] = []
    for (const rel of routeFiles) {
      const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8')
      offenders.push(...offendersInFile(src, rel))
    }
    expect(
      offenders,
      `These verb exports bypass tracedRoute(); wrap them via tracedRoute('VERB', '/api/...', _HANDLER):\n  - ${offenders.join('\n  - ')}`,
    ).toEqual([])
  })
})
