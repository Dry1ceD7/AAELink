#!/usr/bin/env node
// AAELink — OpenAPI 3.1 spec generator (audit §2.5).
//
// Walks `app/api/**/route.ts` and emits an OpenAPI 3.1 spec at
// `docs/openapi.json`. The generator does not parse request/response bodies —
// it captures only the route-and-method surface plus the `// keep:` markers
// that tag each route's category (added in v0.0.30 by `mark-orphan-routes`).
//
// To get richer JSON-Schema fidelity, future work is to add typed Zod schemas
// to each route and emit those. For now this is a 30-second route inventory
// you can hand to clients without standing up a separate doc site.
//
// Run:
//   node scripts/gen-openapi.mjs
// Output:
//   docs/openapi.json (overwritten each run)

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'desktop_dist'])

function walk(dir, want) {
  let out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e)
    let s
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) {
      if (!SKIP.has(e)) out = out.concat(walk(full, want))
    } else if (full.endsWith(want)) {
      out.push(full)
    }
  }
  return out
}

const TRACED_RE = /tracedRoute\(\s*['"](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*[A-Za-z_]+\s*\)/g
const KEEP_RE = /^\/\/\s*keep:\s*(.+)$/m

/** Convert a Next.js dynamic segment (`[id]`) to OpenAPI ({id}). */
function pathToOpenApi(p) {
  return p.replace(/\[([^\]]+)\]/g, '{$1}')
}

/** Pull `{param}` names so we can emit `parameters: [{ in: path, ... }]`. */
function paramsFromPath(p) {
  const out = []
  const re = /\{([^}]+)\}/g
  let m
  while ((m = re.exec(p)) !== null) {
    out.push({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })
  }
  return out
}

const files = walk(join(ROOT, 'app/api'), 'route.ts')
const paths = {}
let total = 0
const tagSet = new Set()

for (const file of files) {
  const body = readFileSync(file, 'utf8')
  const keepMatch = body.match(KEEP_RE)
  const keep = keepMatch ? keepMatch[1].trim() : null

  // Coarse tag from the first directory under /api/.
  // /Users/.../app/api/admin/jobs/route.ts → tag = "admin"
  const rel = file.slice(ROOT.length + 1)
  const segs = rel.split('/')
  const apiIdx = segs.indexOf('api')
  const tag = apiIdx >= 0 && segs[apiIdx + 1] ? segs[apiIdx + 1] : 'misc'
  tagSet.add(tag)

  let m
  TRACED_RE.lastIndex = 0
  while ((m = TRACED_RE.exec(body)) !== null) {
    const method = m[1].toLowerCase()
    const apiPath = m[2]
    const oasPath = pathToOpenApi(apiPath)
    paths[oasPath] = paths[oasPath] || {}
    paths[oasPath][method] = {
      summary: `${method.toUpperCase()} ${apiPath}`,
      tags: [tag],
      ...(keep ? { description: `_marker:_ ${keep}` } : {}),
      parameters: paramsFromPath(oasPath),
      responses: {
        '200': { description: 'OK' },
        '401': { description: 'Unauthorized — no session cookie' },
        '403': { description: 'Forbidden' },
        '404': { description: 'Not found' },
      },
    }
    total += 1
  }
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'AAELink HTTP API',
    version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
    summary: 'Auto-generated route inventory. Method/path surface only — request/response schemas not yet introspected.',
  },
  servers: [{ url: 'https://example.com', description: 'Replace with your AAELink deployment URL' }],
  tags: [...tagSet].sort().map(t => ({ name: t })),
  paths,
}

mkdirSync(join(ROOT, 'docs'), { recursive: true })
const outPath = join(ROOT, 'docs/openapi.json')
writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n')

console.log(`OpenAPI spec written to docs/openapi.json`)
console.log(`  routes scanned: ${files.length}`)
console.log(`  operations:     ${total}`)
console.log(`  tags:           ${tagSet.size}`)
