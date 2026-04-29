import { NextResponse } from 'next/server'
import type { Pool } from 'pg'
import { userCanReadChannel } from '@/lib/collab-access'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { isAllowedReactionKey, type ReactionSummary } from '@/lib/reactions'
import { readSessionUserId } from '@/lib/session'

async function summarizeForMessage(
  pool: Pool,
  viewerId: string,
  messageId: string
): Promise<ReactionSummary[]> {
  const { rows } = await pool.query<{
    reaction_key: string
    cnt: string
    me: boolean
  }>(
    `SELECT reaction_key,
            COUNT(*)::int AS cnt,
            BOOL_OR(user_id = $2::text) AS me
     FROM aaelink.message_reactions
     WHERE message_id = $1
     GROUP BY reaction_key`,
    [messageId, viewerId]
  )
  return rows.map(r => ({
    key: r.reaction_key,
    count: Number(r.cnt) || 0,
    me: Boolean(r.me)
  }))
}

/** Toggle a quick reaction on a message (add/remove). */
export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as { message_id?: string; key?: string }
  const messageId = String(body.message_id || '').trim()
  const key = String(body.key || '').trim()
  if (!messageId || !isAllowedReactionKey(key)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }

  const mr = await pool.query<{ channel_id: string }>(
    `SELECT channel_id FROM aaelink.messages WHERE id = $1`,
    [messageId]
  )
  const ch = mr.rows[0]?.channel_id
  if (!ch) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await userCanReadChannel(pool, uid, ch))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const del = await pool.query(
    `DELETE FROM aaelink.message_reactions
     WHERE message_id = $1 AND user_id = $2 AND reaction_key = $3`,
    [messageId, uid, key]
  )
  if ((del.rowCount ?? 0) === 0) {
    const now = Date.now()
    await pool.query(
      `INSERT INTO aaelink.message_reactions (message_id, user_id, reaction_key, created_at)
       VALUES ($1, $2, $3, $4)`,
      [messageId, uid, key, now]
    )
  }

  const reactions = await summarizeForMessage(pool, uid, messageId)
  return NextResponse.json({ message_id: messageId, reactions })
}
