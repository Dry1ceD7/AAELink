#!/usr/bin/env node
// One-shot helper that prepends `// keep: <reason>` to a list of route.ts files.
// Run after a manual review of `find-orphan-routes.mjs` output. Idempotent — if a
// `// keep:` marker is already present in the file we skip it.
//
// Reasons map to one of three buckets:
//   - "enterprise admin surface kept for parity" — deliberately exposed admin API
//     that the UI hasn't wired up yet, but external operators / scripts may call.
//   - "slack-compat surface" — methods that mirror Slack's web API shape so a
//     Slack client can be pointed at AAELink.
//   - "external integration entry point" — webhooks, IdPs, push provider, etc.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

const ENTERPRISE_ADMIN = `enterprise admin surface kept for parity (intentional, not yet wired into UI)`
const SLACK_COMPAT = `slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)`
const EXTERNAL = `external integration entry point (webhook / IdP / push provider / device)`

// Each entry: { path: '/api/...', reason: string }
const TARGETS = [
  // ── Enterprise admin (the big chunk) ───────────────────────────────
  ['admin/analytics', ENTERPRISE_ADMIN],
  ['admin/app-policies', ENTERPRISE_ADMIN],
  ['admin/backups', ENTERPRISE_ADMIN],
  ['admin/bulk-provision', ENTERPRISE_ADMIN],
  ['admin/channel-archival', ENTERPRISE_ADMIN],
  ['admin/cluster', ENTERPRISE_ADMIN],
  ['admin/data-residency', ENTERPRISE_ADMIN],
  ['admin/feature-flags', ENTERPRISE_ADMIN],
  ['admin/guests', ENTERPRISE_ADMIN],
  ['admin/ip-access', ENTERPRISE_ADMIN],
  ['admin/jobs', ENTERPRISE_ADMIN],
  ['admin/ldap', ENTERPRISE_ADMIN],
  ['admin/markdown-config', ENTERPRISE_ADMIN],
  ['admin/media-policy', ENTERPRISE_ADMIN],
  ['admin/rate-limits', ENTERPRISE_ADMIN],
  ['admin/retention', ENTERPRISE_ADMIN],
  ['admin/retention/enforce', ENTERPRISE_ADMIN],
  ['admin/session-policy', ENTERPRISE_ADMIN],
  ['admin/sessions', ENTERPRISE_ADMIN],
  ['admin/system', ENTERPRISE_ADMIN],
  ['admin/webhook-dlq', ENTERPRISE_ADMIN],
  ['compliance/barriers', ENTERPRISE_ADMIN],
  ['compliance/ediscovery', ENTERPRISE_ADMIN],
  ['moderation/reports', ENTERPRISE_ADMIN],
  ['team/billing', ENTERPRISE_ADMIN],
  ['team/info', ENTERPRISE_ADMIN],
  ['team/preferences', ENTERPRISE_ADMIN],
  ['team/profile', ENTERPRISE_ADMIN],

  // ── Slack-compat / parity surface ──────────────────────────────────
  ['channels/posting-perms', SLACK_COMPAT],
  ['channels/rename', SLACK_COMPAT],
  ['channels/topic', SLACK_COMPAT],
  ['channel-members/roles', SLACK_COMPAT],
  ['dnd', SLACK_COMPAT],
  ['files/comments', SLACK_COMPAT],
  ['files/preview', SLACK_COMPAT],
  ['files/remote', SLACK_COMPAT],
  ['files/scan', SLACK_COMPAT],
  ['messages/attachments', SLACK_COMPAT],
  ['messages/clips', SLACK_COMPAT],
  ['messages/forward', SLACK_COMPAT],
  ['messages/permalink', SLACK_COMPAT],
  ['messages/reactions/users', SLACK_COMPAT],
  ['messages/scheduled', SLACK_COMPAT],
  ['search/advanced', SLACK_COMPAT],
  ['search/files', SLACK_COMPAT],
  ['sidebar/sections', SLACK_COMPAT],
  ['slash-commands', SLACK_COMPAT],
  ['users/directory', SLACK_COMPAT],
  ['user/accessibility', SLACK_COMPAT],
  ['workspaces/invite-link', SLACK_COMPAT],
  ['workspaces/switcher', SLACK_COMPAT],
  ['collab/typing', SLACK_COMPAT],
  ['docs/canvas/access', SLACK_COMPAT],
  ['docs/canvas/sections', SLACK_COMPAT],
  ['documents/find-replace', SLACK_COMPAT],
  ['i18n/locales', SLACK_COMPAT],

  // ── External integration entry points ──────────────────────────────
  ['integrations/bots', EXTERNAL],
  ['integrations/email-ingestion', EXTERNAL],
  ['integrations/events', EXTERNAL],
  ['integrations/plugins', EXTERNAL],
  ['notifications/email', EXTERNAL],
  ['notifications/email/templates', EXTERNAL],
  ['notifications/push', EXTERNAL],
  ['updates/check', EXTERNAL],
  ['webhooks/v2', EXTERNAL],
]

let updated = 0
let skipped = 0
const missing = []

for (const [rel, reason] of TARGETS) {
  const file = join(ROOT, 'app/api', rel, 'route.ts')
  let body
  try { body = readFileSync(file, 'utf8') }
  catch { missing.push(rel); continue }
  if (/^\/\/\s*keep:/m.test(body)) { skipped++; continue }
  // Insert marker as the very first line, preserving any shebang or directive
  // (none of the route.ts files have one in this repo).
  const next = `// keep: ${reason}\n${body}`
  writeFileSync(file, next)
  updated++
}

console.log(`Updated ${updated}, skipped ${skipped} (already marked), missing ${missing.length}.`)
if (missing.length) {
  console.log('Missing route files:')
  for (const m of missing) console.log('  ' + m)
}
