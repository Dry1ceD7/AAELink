import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

const MAX_Q = 200
const DEFAULT_LIMIT = 30

/** Workspace-wide message search (channels the user can access). */
export async function GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const url = new URL(req.url)
  const workspace_id = String(url.searchParams.get('workspace_id') || url.searchParams.get('team_id') || '').trim()
  const q = String(url.searchParams.get('q') || '').trim()
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT))

  if (!workspace_id) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!q) return NextResponse.json({ error: 'q_required' }, { status: 400 })
  if (q.length > MAX_Q) return NextResponse.json({ error: 'q_too_long' }, { status: 400 })

  const member = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspace_id, uid]
  )
  if (member.rows.length === 0) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const pattern = `%${escaped}%`
  const rootFilter = `(m.root_id IS NULL OR m.root_id = '')`

  const { rows } = await pool.query<{
    id: string
    channel_id: string
    channel_name: string
    channel_display: string
    channel_type: string
    body: string
    created_at: string
  }>(
    `SELECT m.id, m.channel_id, c.name AS channel_name, c.display_name AS channel_display, c.type AS channel_type,
            m.body, m.created_at AS created_at
     FROM aaelink.messages m
     INNER JOIN aaelink.channels c ON c.id = m.channel_id AND c.workspace_id = $1::text
     INNER JOIN aaelink.workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = $2::text
     WHERE ${rootFilter}
       AND (c.type <> 'D' OR c.dm_user_a = $2::text OR c.dm_user_b = $2::text)
       AND m.body ILIKE $3 ESCAPE '\\'
     ORDER BY m.created_at DESC
     LIMIT $4::int`,
    [workspace_id, uid, pattern, limit]
  )

  return NextResponse.json({
    hits: rows.map(r => ({
      id: r.id,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_display: r.channel_display,
      channel_type: r.channel_type,
      snippet: r.body.length > 180 ? `${r.body.slice(0, 177)}...` : r.body,
      created_at: Number(r.created_at)
    }))
  })
}
