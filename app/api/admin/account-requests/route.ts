import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { getAdminSession } from '@/lib/adminAuth'
import { tracedRoute } from '@/lib/tracedRoute'

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { rows } = await pool.query(
    `SELECT id, created_at, full_name, work_email, work_phone, note, status, otp_expires_at, verified_at
     FROM aaelink.account_requests ORDER BY created_at DESC LIMIT 200`
  )
  return NextResponse.json({ requests: rows })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/account-requests', _GET)
