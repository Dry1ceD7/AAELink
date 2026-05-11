import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Message Drafts API (Slack parity).
 *
 * Drafts persist across devices and sessions so users don't lose in-progress messages.
 *
 * GET    /api/drafts?workspace_id=...  — list all drafts for the user
 * PUT    /api/drafts                   — upsert a draft (auto-save)
 * DELETE /api/drafts                   — delete a draft (after sending or manual discard)
 */

/** GET — list user's drafts */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim() || ''

  let sql = `
    SELECT d.id, d.channel_id, d.root_id, d.body, d.updated_at,
           c.name AS channel_name, c.display_name AS channel_display
    FROM aaelink.message_drafts d
    LEFT JOIN aaelink.channels c ON c.id = d.channel_id
    WHERE d.user_id = $1
  `
  const params: (string | number)[] = [uid]
  let idx = 2

  if (channelId) {
    sql += ` AND d.channel_id = $${idx}`
    params.push(channelId)
    idx++
  } else if (workspaceId) {
    sql += ` AND c.workspace_id = $${idx}`
    params.push(workspaceId)
    idx++
  }

  sql += ` ORDER BY d.updated_at DESC LIMIT 100`

  const { rows } = await pool.query(sql, params)

  return NextResponse.json({ drafts: rows })
}

/** PUT — upsert a draft (auto-save on keystroke debounce) */
async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    root_id?: string
    body?: string
  }

  const channelId = String(body.channel_id || '').trim()
  const rootId = String(body.root_id || '').trim()
  const draftBody = String(body.body ?? '').slice(0, 40000) // 40K char max

  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // If body is empty, delete the draft instead
  if (!draftBody.trim()) {
    await pool.query(
      `DELETE FROM aaelink.message_drafts WHERE user_id = $1 AND channel_id = $2 AND root_id = $3`,
      [uid, channelId, rootId]
    )
    return NextResponse.json({ ok: true, action: 'deleted' })
  }

  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.message_drafts (id, user_id, channel_id, root_id, body, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, channel_id, root_id) DO UPDATE SET
       body = EXCLUDED.body,
       updated_at = EXCLUDED.updated_at`,
    [randomUUID(), uid, channelId, rootId, draftBody, now]
  )

  return NextResponse.json({ ok: true, action: 'saved', updated_at: now })
}

/** DELETE — discard a draft */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    root_id?: string
    draft_id?: string
  }

  if (body.draft_id) {
    await pool.query(
      `DELETE FROM aaelink.message_drafts WHERE id = $1 AND user_id = $2`,
      [body.draft_id, uid]
    )
  } else if (body.channel_id) {
    const rootId = String(body.root_id || '').trim()
    await pool.query(
      `DELETE FROM aaelink.message_drafts WHERE user_id = $1 AND channel_id = $2 AND root_id = $3`,
      [uid, body.channel_id, rootId]
    )
  } else {
    return NextResponse.json({ error: 'channel_id_or_draft_id_required' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/drafts', _GET)
export const PUT    = tracedRoute('PUT',    '/api/drafts', _PUT)
export const DELETE = tracedRoute('DELETE', '/api/drafts', _DELETE)
