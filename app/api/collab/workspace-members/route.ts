import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

export async function GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const workspace_id = String(url.searchParams.get('workspace_id') || url.searchParams.get('team_id') || '')
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  await ensureSchema()
  const { rows: mem } = await pool.query(
    `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspace_id, uid]
  )
  if (mem.length === 0) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.nickname, u.last_seen_at, u.avatar_url, u.job_title, u.phone, u.timezone, u.status_text, u.status_emoji
     FROM aaelink.users u
     INNER JOIN aaelink.workspace_members m ON m.user_id = u.id AND m.workspace_id = $1
     ORDER BY u.username ASC`,
    [workspace_id]
  )
  return NextResponse.json({ users: rows })
}
