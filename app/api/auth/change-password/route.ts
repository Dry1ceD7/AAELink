import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { hashPassword, verifyPassword } from '@/lib/password'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  let body: { current_password?: string; new_password?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const current = body.current_password
  const next = body.new_password
  if (!current || !next) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (next.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 422 })
  }
  if (current === next) {
    return NextResponse.json({ error: 'password_same' }, { status: 422 })
  }

  const { rows } = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!verifyPassword(current, row.password_hash)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const newHash = hashPassword(next)
  await pool.query(
    `UPDATE aaelink.users SET password_hash = $1, updated_at = now() WHERE id = $2`,
    [newHash, uid]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/auth/change-password', _POST)
