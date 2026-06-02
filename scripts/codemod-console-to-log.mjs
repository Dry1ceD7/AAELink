#!/usr/bin/env node
/**
 * v0.0.45 codemod — replace `console.{log,info,warn,error,debug}(` callsites
 * in `lib/` (excluding `lib/worker.ts`, which gets its own dedicated batch
 * because of its size) with the central `lib/log.ts` API.
 *
 * The script is intentionally simple: it replaces the call shape but does
 * NOT restructure the message — `log.info('foo')` accepts the same string
 * `console.log('foo')` did. The `name:` and structured-fields refinement
 * lands in a follow-on hand pass per file.
 *
 * Idempotent: re-running on already-migrated files is a no-op (skips when
 * `import { log } from '@/lib/log'` is present).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const FILES = [
  'lib/auditStream.ts',
  'lib/auditLog.ts',
  'lib/sendContactOtp.ts',
  'lib/tracing.ts',
  'lib/otelExport.ts',
  'lib/webhookEngine.ts',
  'lib/scheduledMessageProcessor.ts',
  'lib/puzzleBox/pipeline.ts',
  'lib/puzzleBox/deliver.ts',
]

let migrated = 0
let skipped = 0

for (const rel of FILES) {
  const full = join(ROOT, rel)
  if (!existsSync(full)) {
    console.warn(`missing: ${rel}`)
    continue
  }
  let body = readFileSync(full, 'utf8')

  if (body.includes("from '@/lib/log'")) {
    skipped++
    continue
  }
  if (!/console\.(log|info|warn|error|debug)\(/.test(body)) {
    skipped++
    continue
  }

  // Insert `import { log } from '@/lib/log'` after the last import line.
  const importLines = [...body.matchAll(/^import [^\n]+\n/gm)]
  if (importLines.length > 0) {
    const last = importLines[importLines.length - 1]
    const idx = last.index + last[0].length
    body = body.slice(0, idx) + "import { log } from '@/lib/log'\n" + body.slice(idx)
  }

  body = body.replace(/console\.log\(/g, 'log.info(')
  body = body.replace(/console\.info\(/g, 'log.info(')
  body = body.replace(/console\.warn\(/g, 'log.warn(')
  body = body.replace(/console\.error\(/g, 'log.error(')
  body = body.replace(/console\.debug\(/g, 'log.debug(')

  writeFileSync(full, body)
  console.log(`migrated: ${rel}`)
  migrated++
}

console.log(`\nDone. migrated=${migrated} skipped=${skipped}`)
