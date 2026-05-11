import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Channel Categories — sidebar grouping (Slack-style).
 *
 * GET  — list the user's channel categories + assignments
 * PUT  — upsert a channel into a category (star/favorite/custom)
 * DELETE — remove a channel from a category
 */

const DEFAULT_CATEGORIES = ['favorites', 'channels', 'direct_messages']

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { rows } = await pool.query(
    `SELECT channel_id, category, sort_order
     FROM aaelink.channel_categories
     WHERE user_id = $1
     ORDER BY sort_order ASC, category ASC`,
    [uid]
  )

  return NextResponse.json({ categories: rows })
}

async function _PUT(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { channel_id, category, sort_order } = (await req.json()) as {
    channel_id?: string
    category?: string
    sort_order?: number
  }
  if (!channel_id || !category) {
    return NextResponse.json({ error: 'channel_id_and_category_required' }, { status: 400 })
  }

  const cat = category.toLowerCase().slice(0, 50)
  const order = typeof sort_order === 'number' ? sort_order : 0

  await pool.query(
    `INSERT INTO aaelink.channel_categories (user_id, channel_id, category, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET
       category = $3,
       sort_order = $4`,
    [uid, channel_id, cat, order]
  )

  return NextResponse.json({ ok: true })
}

async function _DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { channel_id } = (await req.json()) as { channel_id?: string }
  if (!channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  await pool.query(
    `DELETE FROM aaelink.channel_categories WHERE user_id = $1 AND channel_id = $2`,
    [uid, channel_id]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channel-categories', _GET)
export const PUT    = tracedRoute('PUT', '/api/channel-categories', _PUT)
export const DELETE = tracedRoute('DELETE', '/api/channel-categories', _DELETE)
