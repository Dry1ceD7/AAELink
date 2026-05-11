import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Team Preferences API — Slack team.preferences parity.
 *
 * GET  /api/team/preferences?workspace_id=... — get workspace preferences
 * POST /api/team/preferences — update workspace preferences (admin only)
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const wsId = req.nextUrl.searchParams.get('workspace_id') || ''

  await ensureTeamPrefsTable(pool)

  const { rows } = await pool.query(
    `SELECT key, value FROM aaelink.team_preferences WHERE workspace_id = $1 ORDER BY key`,
    [wsId || '__default__']
  )

  const prefs: Record<string, unknown> = {}
  for (const r of rows) {
    try { prefs[r.key as string] = JSON.parse(r.value as string) }
    catch { prefs[r.key as string] = r.value }
  }

  // Return with defaults
  return NextResponse.json({
    preferences: {
      default_channels: prefs.default_channels || [],
      who_can_create_channels: prefs.who_can_create_channels || 'everyone',
      who_can_post_in_general: prefs.who_can_post_in_general || 'everyone',
      who_can_manage_integrations: prefs.who_can_manage_integrations || 'admins',
      allow_message_editing: prefs.allow_message_editing ?? true,
      message_edit_window_mins: prefs.message_edit_window_mins ?? 0,  // 0 = unlimited
      allow_message_deleting: prefs.allow_message_deleting ?? true,
      display_real_names: prefs.display_real_names ?? true,
      require_at_for_mention: prefs.require_at_for_mention ?? false,
      allow_huddles: prefs.allow_huddles ?? true,
      allow_clips: prefs.allow_clips ?? true,
      default_sort_order: prefs.default_sort_order || 'chronological',
      retention_type: prefs.retention_type || 'keep_all',
      retention_days: prefs.retention_days ?? 0,
      locale: prefs.locale || 'en-US',
      ...prefs,
    },
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Check admin
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    preferences?: Record<string, unknown>
  }

  const wsId = body.workspace_id || '__default__'
  const prefs = body.preferences || {}

  await ensureTeamPrefsTable(pool)
  const now = Date.now()

  for (const [key, value] of Object.entries(prefs)) {
    await pool.query(
      `INSERT INTO aaelink.team_preferences (workspace_id, key, value, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = $3, updated_at = $4`,
      [wsId, key, JSON.stringify(value), now]
    )
  }

  return NextResponse.json({ ok: true, updated: Object.keys(prefs).length })
}

async function ensureTeamPrefsTable(pool: import('pg').Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.team_preferences (
      workspace_id TEXT NOT NULL DEFAULT '__default__',
      key          TEXT NOT NULL,
      value        TEXT NOT NULL DEFAULT '',
      updated_at   BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, key)
    )
  `).catch(() => {})
}

export const GET  = tracedRoute('GET',  '/api/team/preferences', _GET)
export const POST = tracedRoute('POST', '/api/team/preferences', _POST)
