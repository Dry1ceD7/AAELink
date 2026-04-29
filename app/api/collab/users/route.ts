import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, 200) : []
  if (ids.length === 0) return NextResponse.json({ users: [] })
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.username, u.email, u.first_name, u.last_name, u.nickname
     FROM aaelink.users u
     WHERE u.id = ANY($1::text[])
     AND (
       u.id = $2
       OR EXISTS (
         SELECT 1 FROM aaelink.workspace_members m1
         INNER JOIN aaelink.workspace_members m2 ON m1.workspace_id = m2.workspace_id
         WHERE m1.user_id = $2 AND m2.user_id = u.id
       )
     )`,
    [ids, uid]
  )
  return NextResponse.json({ users: rows })
}
