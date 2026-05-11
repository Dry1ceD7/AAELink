#!/usr/bin/env node
/**
 * Auto-instrument Next.js route handlers with tracedRoute() middleware.
 *
 * Usage: node scripts/instrument-routes.mjs
 *
 * This script:
 * 1. Finds all app/api route.ts files missing tracedRoute
 * 2. Adds the tracedRoute import
 * 3. Renames exported handler functions (GET, POST, etc.) to _GET, etc.
 * 4. Appends traced exports at the end of each file
 */
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// Find all untraced route files
const files = execSync(
  "find app/api -name 'route.ts' -exec grep -L 'tracedRoute' {} \\;",
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean)

console.log(`Found ${files.length} untraced route files`)

let instrumented = 0
let skipped = 0

for (const file of files) {
  let content = readFileSync(file, 'utf8')

  // Extract route path from file path: app/api/foo/bar/route.ts -> /api/foo/bar
  const routePath = '/' + file
    .replace(/^app\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\/\[([^\]]+)\]/g, '/:$1')

  // Find which HTTP methods are exported
  const exportedMethods = METHODS.filter(m =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\s*\\(`).test(content)
  )

  if (exportedMethods.length === 0) {
    // Check for export const pattern (already using tracedRoute or some other export)
    const constExports = METHODS.filter(m =>
      new RegExp(`export\\s+const\\s+${m}\\s*=`).test(content)
    )
    if (constExports.length > 0) {
      console.log(`  SKIP (const export): ${file}`)
      skipped++
      continue
    }
    console.log(`  SKIP (no handlers): ${file}`)
    skipped++
    continue
  }

  // Add import
  const importLine = "import { tracedRoute } from '@/lib/tracedRoute'"
  if (!content.includes('tracedRoute')) {
    // Insert after the last existing import line
    const importRegex = /^import\s+.+$/gm
    let lastImportEnd = 0
    let match
    while ((match = importRegex.exec(content)) !== null) {
      lastImportEnd = match.index + match[0].length
    }
    if (lastImportEnd > 0) {
      content = content.slice(0, lastImportEnd) + '\n' + importLine + content.slice(lastImportEnd)
    } else {
      content = importLine + '\n' + content
    }
  }

  // Rename exports: `export async function GET(` -> `async function _GET(`
  for (const m of exportedMethods) {
    content = content.replace(
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\s*\\(`),
      `$1function _${m}(`
    )
  }

  // Determine if handlers use NextRequest or Request
  const usesNextRequest = content.includes('NextRequest')

  // Build traced exports block
  const tracedExports = exportedMethods.map(m => {
    // Check if the handler takes a request parameter
    const handlerRegex = new RegExp(`function\\s+_${m}\\s*\\(([^)]*)\\)`)
    const paramMatch = content.match(handlerRegex)
    const hasParams = paramMatch && paramMatch[1].trim().length > 0
    
    const cast = (hasParams && usesNextRequest) || !hasParams
      ? ' as unknown as (req: Request) => Promise<Response>'
      : ''
    
    return `export const ${m.padEnd(6)} = tracedRoute('${m}', '${routePath}', _${m}${cast})`
  })

  const block = '\n// ── Traced exports ──────────────────────────────────────────────────\n'
    + tracedExports.join('\n')
    + '\n'

  // Append at end
  content = content.trimEnd() + '\n' + block

  writeFileSync(file, content, 'utf8')
  console.log(`  ✅ ${file} (${exportedMethods.join(', ')})`)
  instrumented++
}

console.log(`\nDone: ${instrumented} instrumented, ${skipped} skipped`)
