import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Reactions API — Slack reactions.add / reactions.remove / reactions.get / reactions.list parity.
 *
 * GET  /api/reactions — list reactions for a message, or all reacted items for a user
 * POST /api/reactions — add/remove reactions
 *
 * Covers:
 *   - reactions.add — add an emoji reaction
 *   - reactions.remove — remove an emoji reaction
 *   - reactions.get — get reactions for a message/file/comment
 *   - reactions.list — list all items the user has reacted to
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureReactionsTable(pool)

  const view = req.nextUrl.searchParams.get('view') || 'get'
  const messageId = req.nextUrl.searchParams.get('message_id') || req.nextUrl.searchParams.get('timestamp') || ''
  const channelId = req.nextUrl.searchParams.get('channel_id') || req.nextUrl.searchParams.get('channel') || ''

  if (view === 'get' && messageId) {
    // Get reactions for a specific message
    const { rows } = await pool.query<{ emoji: string; user_id: string }>(`
      SELECT emoji, user_id FROM aaelink.message_reactions WHERE message_id = $1
    `, [messageId])

    // Group by emoji
    const reactionMap: Record<string, string[]> = {}
    for (const r of rows) {
      if (!reactionMap[r.emoji]) reactionMap[r.emoji] = []
      reactionMap[r.emoji].push(r.user_id)
    }

    const reactions = Object.entries(reactionMap).map(([name, users]) => ({
      name,
      count: users.length,
      users,
    }))

    return NextResponse.json({
      ok: true,
      type: 'message',
      channel: channelId,
      message: { reactions },
    })
  }

  if (view === 'list') {
    // List all items user has reacted to
    const userId = req.nextUrl.searchParams.get('user_id') || uid
    const limit = Math.min(Number(req.nextUrl.searchParams.get('count') || 50), 200)
    const page = Math.max(Number(req.nextUrl.searchParams.get('page') || 1), 1)
    const offset = (page - 1) * limit

    const { rows } = await pool.query<{
      message_id: string; emoji: string; created_at: number;
      content: string; channel_id: string; message_author: string;
      channel_name: string;
    }>(`
      SELECT mr.message_id, mr.emoji, mr.created_at,
             m.content, m.channel_id, m.user_id AS message_author,
             c.name AS channel_name
      FROM aaelink.message_reactions mr
      JOIN aaelink.messages m ON m.id = mr.message_id
      LEFT JOIN aaelink.channels c ON c.id = m.channel_id
      WHERE mr.user_id = $1
      ORDER BY mr.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset])

    const items = rows.map(r => ({
      type: 'message',
      channel: r.channel_id,
      channel_name: r.channel_name,
      message: {
        text: r.content,
        ts: r.message_id,
        user: r.message_author,
        reactions: [{ name: r.emoji, count: 1 }],
      },
    }))

    return NextResponse.json({
      ok: true,
      items,
      paging: { count: limit, page },
    })
  }

  return NextResponse.json({ error: 'provide message_id or view=list' }, { status: 400 })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureReactionsTable(pool)

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'add' | 'remove'
    channel?: string; timestamp?: string; message_id?: string; name?: string
  }

  const action = body.action || 'add'
  const messageId = body.message_id || body.timestamp || ''
  const emoji = body.name || ''

  if (!messageId || !emoji) {
    return NextResponse.json({ ok: false, error: 'message_id/timestamp and name required' }, { status: 400 })
  }

  if (action === 'add') {
    const id = randomUUID()
    const now = Date.now()
    await pool.query(`
      INSERT INTO aaelink.message_reactions (id, message_id, user_id, emoji, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
    `, [id, messageId, uid, emoji, now])
    return NextResponse.json({ ok: true })
  }

  if (action === 'remove') {
    await pool.query(
      `DELETE FROM aaelink.message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, uid, emoji]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'action must be add or remove' }, { status: 400 })
}

async function ensureReactionsTable(pool: Pool) {
  // This table already exists via migrate.ts, just ensure index
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reactions_user ON aaelink.message_reactions(user_id, created_at DESC)
  `).catch(() => {/* may already exist */})
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET',  '/api/reactions', _GET)
export const POST = tracedRoute('POST', '/api/reactions', _POST)
