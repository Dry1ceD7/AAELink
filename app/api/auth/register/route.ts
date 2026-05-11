import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { hashPassword } from '@/lib/password'
import { tracedRoute } from '@/lib/tracedRoute'

/** Self-service sign-up is only on when explicitly set to `1` (internal deployments usually leave it off). */
function openRegistration(): boolean {
  return process.env.AAELINK_OPEN_REGISTRATION === '1'
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  if (!openRegistration()) {
    const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM aaelink.users`)
    if (Number(rows[0]?.n || 0) > 0) {
      return NextResponse.json({ error: 'registration_closed' }, { status: 403 })
    }
  }
  try {
    const body = (await req.json()) as {
      username?: string
      email?: string
      password?: string
      first_name?: string
      last_name?: string
    }
    const username = String(body.username || '').trim()
    const email = String(body.email || '').trim()
    const password = String(body.password || '')
    if (username.length < 2 || !email.includes('@') || password.length < 8) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    const id = randomUUID()
    const now = Date.now()
    const password_hash = hashPassword(password)
    const first_name = String(body.first_name || '').trim()
    const last_name = String(body.last_name || '').trim()
    await pool.query(
      `INSERT INTO aaelink.users (id, username, email, password_hash, first_name, last_name, nickname, created_at, last_seen_at, platform_role)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, 0, 'employee')`,
      [id, username, email, password_hash, first_name, last_name, now]
    )
    const { rows } = await pool.query(
      `SELECT id, username, email, first_name, last_name, nickname, platform_role, avatar_url, job_title, phone, timezone, status_text, status_emoji FROM aaelink.users WHERE id = $1`,
      [id]
    )
    return NextResponse.json({ user: rows[0] })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === '23505') {
      return NextResponse.json({ error: 'username_or_email_taken' }, { status: 409 })
    }
    return NextResponse.json({ error: 'register_failed' }, { status: 400 })
  }
}

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/auth/register', _POST)
