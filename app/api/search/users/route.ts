import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/** GET /api/search/users?q=... — search users by username/name. */
export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  if (!q || q.length < 1) {
    return NextResponse.json({ users: [] })
  }

  const pattern = `%${q}%`
  const { rows } = await pool.query<{
    id: string; username: string; first_name: string; last_name: string; email: string; avatar_url: string | null; job_title: string | null; phone: string | null; timezone: string | null; status_text: string | null; status_emoji: string | null;
  }>(
    `SELECT id, username, first_name, last_name, email, avatar_url, job_title, phone, timezone, status_text, status_emoji
     FROM aaelink.users
     WHERE username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1
     ORDER BY username ASC LIMIT 20`,
    [pattern]
  )

  return NextResponse.json({ users: rows })
}
