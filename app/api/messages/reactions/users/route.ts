// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { tracedRoute } from '@/lib/api/tracedRoute'

/** GET /api/messages/reactions/users?message_id=&key= — list who reacted with a given key. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const messageId = req.nextUrl.searchParams.get('message_id') ?? ''
  const key = req.nextUrl.searchParams.get('key') ?? ''
  if (!messageId || !key) {
    return NextResponse.json({ error: 'message_id and key required' }, { status: 400 })
  }

  // Verify the user can read the channel containing this message
  const mr = await pool.query<{ channel_id: string }>(
    `SELECT channel_id FROM aaelink.messages WHERE id = $1`, [messageId]
  )
  const ch = mr.rows[0]?.channel_id
  if (!ch) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await userCanReadChannel(pool, uid, ch))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<{
    user_id: string
    username: string
    first_name: string
    last_name: string
    avatar_url: string
    created_at: number
  }>(
    `SELECT r.user_id, r.created_at,
            u.username, u.first_name, u.last_name, u.avatar_url
     FROM aaelink.message_reactions r
     LEFT JOIN aaelink.users u ON u.id = r.user_id
     WHERE r.message_id = $1 AND r.reaction_key = $2
     ORDER BY r.created_at ASC
     LIMIT 20`,
    [messageId, key]
  )

  return NextResponse.json({
    message_id: messageId,
    key,
    users: rows.map(r => ({
      user_id: r.user_id,
      username: r.username,
      display_name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username,
      avatar_url: r.avatar_url,
      reacted_at: r.created_at
    }))
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/messages/reactions/users', _GET)
