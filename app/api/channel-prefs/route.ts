import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

const VALID_LEVELS = ['default', 'all', 'mentions', 'nothing']

/**
 * Channel Notification Preferences API.
 *
 * GET  /api/channel-prefs?channel_id=...   → get pref for caller
 * PUT  /api/channel-prefs                  → upsert pref
 */

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const { rows } = await pool.query<{ level: string; muted: boolean }>(
    `SELECT level, muted FROM aaelink.channel_notification_prefs
     WHERE user_id = $1 AND channel_id = $2`,
    [uid, channelId]
  )

  const pref = rows[0] || { level: 'default', muted: false }
  return NextResponse.json({ channel_id: channelId, level: pref.level, muted: pref.muted })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; level?: string; muted?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const level = body.level ? String(body.level).toLowerCase() : 'default'
  if (!VALID_LEVELS.includes(level)) {
    return NextResponse.json({ error: 'invalid_level' }, { status: 400 })
  }

  const muted = body.muted === true

  await pool.query(
    `INSERT INTO aaelink.channel_notification_prefs (user_id, channel_id, level, muted, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET
       level = $3,
       muted = $4,
       updated_at = $5`,
    [uid, channelId, level, muted, Date.now()]
  )

  return NextResponse.json({ channel_id: channelId, level, muted })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channel-prefs', _GET)
export const PUT    = tracedRoute('PUT', '/api/channel-prefs', _PUT)
