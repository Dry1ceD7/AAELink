import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Starred Channels / Favorites API (Slack sidebar "Starred" section).
 *
 * GET    /api/starred?workspace_id=...   — list user's starred channels
 * POST   /api/starred { channel_id }     — star a channel
 * DELETE /api/starred { channel_id }     — unstar a channel
 * PUT    /api/starred { channel_ids[] }  — reorder starred channels
 */

/** GET — list starred channels (ordered) */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''

  let sql = `
    SELECT s.channel_id, s.sort_order, s.starred_at,
           c.name AS channel_name, c.display_name AS channel_display,
           c.type AS channel_type, c.workspace_id
    FROM aaelink.starred_channels s
    JOIN aaelink.channels c ON c.id = s.channel_id
    WHERE s.user_id = $1
  `
  const params: string[] = [uid]
  let idx = 2

  if (workspaceId) {
    sql += ` AND c.workspace_id = $${idx}`
    params.push(workspaceId)
    idx++
  }

  sql += ` ORDER BY s.sort_order ASC, s.starred_at DESC`

  const { rows } = await pool.query(sql, params)

  return NextResponse.json({ starred: rows })
}

/** POST — star a channel */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channel_id?: string }
  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Get the next sort order
  const { rows: maxOrder } = await pool.query<{ max_order: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM aaelink.starred_channels WHERE user_id = $1`,
    [uid]
  )
  const sortOrder = (maxOrder[0]?.max_order || 0) + 1
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.starred_channels (user_id, channel_id, sort_order, starred_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, channel_id) DO NOTHING`,
    [uid, channelId, sortOrder, now]
  )

  return NextResponse.json({ ok: true, sort_order: sortOrder })
}

/** DELETE — unstar a channel */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channel_id?: string }
  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  await pool.query(
    `DELETE FROM aaelink.starred_channels WHERE user_id = $1 AND channel_id = $2`,
    [uid, channelId]
  )

  return NextResponse.json({ ok: true })
}

/** PUT — reorder starred channels */
async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channel_ids?: string[] }
  const channelIds = body.channel_ids
  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return NextResponse.json({ error: 'channel_ids_required' }, { status: 400 })
  }

  // Update sort_order for each channel in the order provided
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < channelIds.length; i++) {
      await client.query(
        `UPDATE aaelink.starred_channels SET sort_order = $1 WHERE user_id = $2 AND channel_id = $3`,
        [i + 1, uid, channelIds[i]]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/starred', _GET)
export const POST   = tracedRoute('POST',   '/api/starred', _POST)
export const DELETE = tracedRoute('DELETE', '/api/starred', _DELETE)
export const PUT    = tracedRoute('PUT',    '/api/starred', _PUT)
