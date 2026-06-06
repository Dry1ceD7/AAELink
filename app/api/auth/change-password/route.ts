import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  getPasswordPolicy,
  validatePassword,
  isPasswordReused,
  recordPasswordHistory,
} from '@/lib/auth/passwordPolicy'

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
  if (current === next) {
    return NextResponse.json({ error: 'password_same' }, { status: 422 })
  }

  const { rows } = await pool.query<{ password_hash: string; username: string; email: string }>(
    `SELECT password_hash, username, email FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!verifyPassword(current, row.password_hash)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  // Enforce the admin-configured password policy (complexity / username-email).
  const policy = await getPasswordPolicy(pool)
  const detail = validatePassword(policy, next, { username: row.username, email: row.email })
  if (detail.length > 0) {
    return NextResponse.json({ error: 'password_policy_violation', detail }, { status: 400 })
  }

  // History reuse prevention (no-op when history_count = 0).
  if (await isPasswordReused(pool, uid, next, policy, verifyPassword)) {
    return NextResponse.json({ error: 'password_policy_violation', detail: ['password_reused'] }, { status: 400 })
  }

  const newHash = hashPassword(next)
  const now = Date.now()
  // Note: aaelink.users has no `updated_at` column (the prior `updated_at = now()`
  // here referenced a non-existent column and 500'd any real change-password call);
  // password_changed_at is the meaningful write and doubles as the rotation stamp.
  await pool.query(
    `UPDATE aaelink.users SET password_hash = $1, password_changed_at = $2 WHERE id = $3`,
    [newHash, now, uid]
  )
  // Record the OLD hash so a future change cannot reuse it; trims to the window.
  await recordPasswordHistory(pool, uid, row.password_hash, policy, now)

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/auth/change-password', _POST)
