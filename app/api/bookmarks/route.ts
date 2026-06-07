import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'

interface BookmarkRow {
  id: string
  channel_id: string
  title: string
  link_url: string
  emoji: string
  sort_order: number
  added_by: string
  created_at: number
}

/** GET /api/bookmarks?channel_id=... — list bookmarks for a channel. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<BookmarkRow>(
    `SELECT id, channel_id, title, link_url, emoji, sort_order, added_by, created_at
     FROM aaelink.channel_bookmarks
     WHERE channel_id = $1
     ORDER BY sort_order, created_at`,
    [channelId]
  )

  return NextResponse.json({ bookmarks: rows })
}

/** POST /api/bookmarks — create a new bookmark.  Body: { channel_id, title, link_url, emoji? } */
async function _POST(req: NextRequest) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; title?: string; link_url?: string; emoji?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const channelId = String(body.channel_id || '').trim()
  const title = String(body.title || '').trim().slice(0, 100)
  const linkUrl = String(body.link_url || '').trim().slice(0, 2000)
  const emoji = String(body.emoji || '🔗').slice(0, 10)

  if (!channelId || !title || !linkUrl) {
    return NextResponse.json({ error: 'channel_id, title, and link_url are required' }, { status: 400 })
  }

  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Validate URL
  try {
    const u = new URL(linkUrl)
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad protocol')
  } catch {
    return NextResponse.json({ error: 'link_url must be a valid http/https URL' }, { status: 400 })
  }

  // Get next sort order
  const { rows: maxRows } = await pool.query<{ mx: string }>(
    `SELECT COALESCE(MAX(sort_order), 0)::text AS mx FROM aaelink.channel_bookmarks WHERE channel_id = $1`,
    [channelId]
  )
  const nextSort = Number(maxRows[0]?.mx || 0) + 1

  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.channel_bookmarks (id, channel_id, title, link_url, emoji, sort_order, added_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, channelId, title, linkUrl, emoji, nextSort, uid, now]
  )

  return NextResponse.json({
    bookmark: { id, channel_id: channelId, title, link_url: linkUrl, emoji, sort_order: nextSort, added_by: uid, created_at: now }
  }, { status: 201 })
}

/** DELETE /api/bookmarks?id=... — remove a bookmark. */
async function _DELETE(req: NextRequest) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Look up the bookmark to check channel membership before deleting.
  const { rows: bkRows } = await pool.query<{ channel_id: string }>(
    `SELECT channel_id FROM aaelink.channel_bookmarks WHERE id = $1`,
    [id]
  )
  if (bkRows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (!(await userCanReadChannel(pool, uid, bkRows[0].channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await pool.query(
    `DELETE FROM aaelink.channel_bookmarks WHERE id = $1`,
    [id]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/bookmarks', _GET)
export const POST   = tracedRoute('POST',   '/api/bookmarks', _POST)
export const DELETE = tracedRoute('DELETE', '/api/bookmarks', _DELETE)
