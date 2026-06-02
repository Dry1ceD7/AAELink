#!/usr/bin/env node
// Find route.ts files whose URL path is never referenced from app/lib/desktop/scripts.
//
// Heuristics applied to reduce false positives:
//   - Match full path (`/api/channels/leave`)
//   - Match path without the leading `/api/` prefix (`channels/leave`) — this catches
//     dynamic builds like `apiFetch(`/api/${kind}/...`)` where the literal string
//     never contains `/api/`.
//   - Match the trailing two path segments (`channels/leave`) — covers cases where
//     the caller composes the URL piece-by-piece.
//   - For routes with `[param]` segments, also try the path with the param replaced
//     by `${...}` and as a regex pattern.
//   - Routes whose body contains a `// keep: …` marker on any line are treated as
//     intentionally part of the API surface (enterprise admin / Slack-compat /
//     external integrations) and excluded from the orphan list.
//   - Routes in KEEP_PUBLIC are exempted by URL.
//
// Output is split into:
//   * "Probably orphan": no caller hit, no `// keep:` marker, not in KEEP_PUBLIC.
//   * "Loose hit only": missed by exact match but found via the loose patterns —
//     these are the high-risk ones if you delete blindly.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function walk(dir, ext, skipDirs = new Set()) {
  const out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      if (skipDirs.has(e)) continue
      out.push(...walk(full, ext, skipDirs))
    } else if (ext.some(x => full.endsWith(x))) {
      out.push(full)
    }
  }
  return out
}

const skip = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'desktop_dist', 'tests', '__tests__'])

const routeFiles = walk(join(ROOT, 'app/api'), ['route.ts'], skip)
const corpus = [
  ...walk(join(ROOT, 'app'), ['.ts', '.tsx'], skip),
  ...walk(join(ROOT, 'lib'), ['.ts', '.tsx'], skip),
  ...walk(join(ROOT, 'desktop/src'), ['.js', '.html'], skip),
  ...walk(join(ROOT, 'scripts'), ['.ts', '.mjs'], skip),
]
  .filter(f => !f.endsWith('/route.ts'))
  .map(f => ({ f, body: readFileSync(f, 'utf8') }))

function pathKeysFor(routeFile) {
  // /Users/.../app/api/foo/[id]/bar/route.ts → /api/foo/[id]/bar
  const apiPath = '/' + routeFile.slice(ROOT.length + 1, -'/route.ts'.length).replace(/^app\//, '')
  // Without dynamic segments (matches anything after the last static segment too):
  const staticPrefix = apiPath.replace(/\/\[[^\]]+\].*/g, '')
  // Just the path segments after /api/:
  const trailing = apiPath.replace(/^\/api\//, '')
  // Last two segments (most fetches use a recognisable suffix):
  const segs = trailing.split('/')
  const lastTwo = segs.slice(-2).join('/')
  // Matchers:
  const keys = new Set()
  keys.add(apiPath)                           // exact
  if (staticPrefix.length > 5) keys.add(staticPrefix) // tolerate dynamic params
  if (trailing.length > 4) keys.add(trailing)
  if (lastTwo !== trailing && lastTwo.length > 4 && !lastTwo.startsWith('[')) keys.add(lastTwo)
  return { apiPath, staticPrefix, trailing, lastTwo, keys: [...keys] }
}

const orphans = []           // no caller, no keep marker
const looseHits = []         // exact-path miss but caught by loose
const keptByMarker = []      // had a `// keep:` marker

for (const route of routeFiles) {
  const { apiPath, keys } = pathKeysFor(route)
  const body = readFileSync(route, 'utf8')
  const keepMatch = body.match(/^\/\/\s*keep:\s*(.+)$/m)

  let exactHit = false
  let looseHit = false
  let hitKey = ''
  for (const c of corpus) {
    if (c.body.includes(apiPath)) { exactHit = true; break }
  }
  if (!exactHit) {
    for (const k of keys) {
      if (k === apiPath) continue
      const found = corpus.find(c => c.body.includes(k))
      if (found) { looseHit = true; hitKey = k; break }
    }
  }

  if (exactHit) continue
  if (keepMatch) { keptByMarker.push({ apiPath, reason: keepMatch[1].trim() }); continue }
  if (looseHit) looseHits.push({ apiPath, hitKey })
  else orphans.push(apiPath)
}

orphans.sort()
looseHits.sort((a, b) => a.apiPath.localeCompare(b.apiPath))
keptByMarker.sort((a, b) => a.apiPath.localeCompare(b.apiPath))

// Routes that are intentionally callable from outside our codebase
// (Slack compat surface, OIDC/SAML, SCIM, Prometheus, browser bookmarks, etc.).
// Prefer a `// keep: <reason>` marker in the route body over editing this list.
const KEEP_PUBLIC = new Set([
  // External / infrastructure scrape & SIEM targets
  '/api/admin/prometheus',
  '/api/admin/audit-log/stream',
  // SCIM 2.0 surface (consumed by IdPs)
  '/api/scim/v2/Users',
  '/api/scim/v2/Groups',
  '/api/admin/scim',
  // Auth / SSO callbacks
  '/api/auth/openid',
  '/api/auth/sso',
  '/api/auth/mfa',
  '/api/auth/register',
  // Generic Slack-compat aliases (intentionally addressable as Slack endpoints)
  '/api/dialog',
  '/api/views',
  '/api/rtm/connect',
  '/api/test',
  '/api/bots/info',
  '/api/chat',
  // Conversations.* Slack method group — addressable as the Slack web API
  '/api/conversations/list',
  '/api/conversations/info',
  '/api/conversations/history',
  '/api/conversations/replies',
  '/api/conversations/members',
  '/api/conversations/mark',
  '/api/conversations/open',
  '/api/conversations/canvases',
  // Reactions Slack method group
  '/api/reactions',
  // usergroups Slack method group
  '/api/usergroups',
  '/api/usergroups/users',
  // Webhooks signature helper for external integrations
  '/api/webhooks/verify-signature',
])

const drop = orphans.filter(p => !KEEP_PUBLIC.has(p))
console.log('=== Probably orphan (no caller, even with loose match) ===')
for (const o of orphans) console.log('  ' + o + (KEEP_PUBLIC.has(o) ? '   [PUBLIC — keep]' : ''))
console.log(`\nProbably orphan: ${orphans.length} / ${routeFiles.length} total routes`)
console.log(`Deletion candidates after KEEP_PUBLIC filter: ${drop.length}`)

console.log('\n=== Loose-hit only (likely false positive — manually verify) ===')
for (const o of looseHits) console.log(`  ${o.apiPath}  [matched on: ${o.hitKey}]`)
console.log(`Loose-hit only: ${looseHits.length}`)

console.log(`\n=== Kept by '// keep:' marker (${keptByMarker.length}) ===`)
for (const k of keptByMarker) console.log(`  ${k.apiPath}  — ${k.reason}`)
