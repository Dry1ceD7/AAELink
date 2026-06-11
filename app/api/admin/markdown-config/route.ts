// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Rich Text / Markdown Configuration API.
 *
 * GET /api/admin/markdown-config — get rendering configuration
 * PUT /api/admin/markdown-config — update rendering rules (admin only)
 *
 * Controls which markdown features are enabled platform-wide:
 *   - Code blocks (syntax highlighting)
 *   - Tables
 *   - LaTeX / KaTeX math
 *   - Mermaid diagrams
 *   - @mentions (user, channel, team)
 *   - Slash commands inline rendering
 *   - Link unfurling
 *   - Custom emoji
 *   - Auto-link URLs
 *   - HTML sanitization level
 */

const DEFAULT_MARKDOWN_CONFIG = {
  // Core markdown
  bold: true,
  italic: true,
  strikethrough: true,
  headings: true,
  blockquotes: true,
  ordered_lists: true,
  unordered_lists: true,
  task_lists: true,
  horizontal_rules: true,

  // Extended
  code_inline: true,
  code_blocks: true,
  syntax_highlighting: true,
  tables: true,
  links: true,
  images: true,
  autolink_urls: true,

  // Advanced
  latex_math: false,
  mermaid_diagrams: false,
  footnotes: false,

  // Platform features
  mentions_users: true,
  mentions_channels: true,
  mentions_here: true,
  mentions_all: true,
  custom_emoji: true,
  emoji_shortcodes: true,
  link_unfurling: true,
  spoiler_tags: true,

  // Security
  html_allowed: false,
  max_message_length: 40000,
  max_code_block_length: 100000,

  // Rendering
  renderer: 'markdown-it',
  theme_code_light: 'github',
  theme_code_dark: 'github-dark',
}

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'markdown_config'`
  )

  let config = { ...DEFAULT_MARKDOWN_CONFIG }
  if (rows[0]?.value) {
    try { config = { ...config, ...JSON.parse(rows[0].value) } } catch { /**/ }
  }

  return NextResponse.json({ config })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<typeof DEFAULT_MARKDOWN_CONFIG>

  const { rows: existing } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'markdown_config'`
  )
  let current = { ...DEFAULT_MARKDOWN_CONFIG }
  if (existing[0]?.value) {
    try { current = { ...current, ...JSON.parse(existing[0].value) } } catch { /**/ }
  }

  const updated = { ...current, ...body }
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('markdown_config', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  return NextResponse.json({ config: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/markdown-config', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/markdown-config', _PUT)
