import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET  /api/channels/stars?workspace_id=...       — list starred channel IDs for the user
 * POST /api/channels/stars  { channel_id, starred } — toggle star for a channel
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const wsId = req.nextUrl.searchParams.get('workspace_id')?.trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const { rows } = await pool.query<{ channel_id: string }>(
    `SELECT cs.channel_id FROM aaelink.channel_stars cs
     JOIN aaelink.channels c ON c.id = cs.channel_id
     WHERE cs.user_id = $1 AND c.workspace_id = $2
     ORDER BY cs.created_at ASC`,
    [uid, wsId]
  )

  return NextResponse.json({ starred: rows.map(r => r.channel_id) })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json()) as { channel_id?: string; starred?: boolean }
  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const starred = body.starred !== false // default to true

  if (starred) {
    await pool.query(
      `INSERT INTO aaelink.channel_stars (user_id, channel_id, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, channel_id) DO NOTHING`,
      [uid, channelId, Date.now()]
    )
  } else {
    await pool.query(
      `DELETE FROM aaelink.channel_stars WHERE user_id = $1 AND channel_id = $2`,
      [uid, channelId]
    )
  }

  return NextResponse.json({ ok: true, starred })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channels/stars', _GET)
export const POST   = tracedRoute('POST', '/api/channels/stars', _POST)
