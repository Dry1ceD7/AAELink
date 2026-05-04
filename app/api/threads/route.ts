import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/** GET /api/threads — list threads (root messages) the current user participates in. */
export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const wsId = req.nextUrl.searchParams.get('workspace_id') || ''
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Find root messages in which the user participated (either authored the root or replied in the thread)
  const { rows } = await pool.query(
    `WITH user_threads AS (
       -- Threads where the user posted a reply
       SELECT DISTINCT m.root_id AS root_id
       FROM aaelink.messages m
       JOIN aaelink.channels c ON c.id = m.channel_id
       WHERE m.user_id = $1 AND m.root_id != '' AND c.workspace_id = $2
       UNION
       -- Threads started by the user (root messages that have replies)
       SELECT DISTINCT m.id AS root_id
       FROM aaelink.messages m
       JOIN aaelink.channels c ON c.id = m.channel_id
       WHERE m.user_id = $1 AND m.root_id = '' AND c.workspace_id = $2
         AND EXISTS (SELECT 1 FROM aaelink.messages r WHERE r.root_id = m.id LIMIT 1)
     )
     SELECT rm.id, rm.channel_id, rm.user_id AS author_id, rm.body, rm.created_at,
            c.display_name AS channel_name,
            (SELECT COUNT(*) FROM aaelink.messages r WHERE r.root_id = rm.id) AS reply_count,
            (SELECT MAX(r.created_at) FROM aaelink.messages r WHERE r.root_id = rm.id) AS last_reply_at
     FROM user_threads ut
     JOIN aaelink.messages rm ON rm.id = ut.root_id
     JOIN aaelink.channels c ON c.id = rm.channel_id
     ORDER BY last_reply_at DESC NULLS LAST
     LIMIT 50`,
    [uid, wsId]
  )

  return NextResponse.json({ threads: rows })
}
