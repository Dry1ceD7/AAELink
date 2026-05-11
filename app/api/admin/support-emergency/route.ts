import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { getAdminSession } from '@/lib/adminAuth'
import { tracedRoute } from '@/lib/tracedRoute'

type Row = {
  id: string
  user_id: string
  body: string
  created_at: string | number
  status: string
  username: string
  email: string
}

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { rows } = await pool.query<Row>(
    `SELECT m.id, m.user_id, m.body, m.created_at, m.status, u.username, u.email
     FROM aaelink.support_emergency_messages m
     JOIN aaelink.users u ON u.id = m.user_id
     ORDER BY m.created_at DESC
     LIMIT 100`
  )
  return NextResponse.json({
    messages: rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      username: r.username,
      email: r.email,
      body: r.body,
      created_at: Number(r.created_at) || r.created_at,
      status: r.status
    }))
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/support-emergency', _GET)
