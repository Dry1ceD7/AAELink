import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { verifyPassword } from '@/lib/password'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/session'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

function isDatabaseConnectivityError(err: unknown): boolean {
  const o = err as { code?: string; message?: string }
  const code = typeof o?.code === 'string' ? o.code : ''
  const msg = typeof o?.message === 'string' ? o.message : String(err)
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    /ECONNREFUSED|connect ECONNREFUSED|getaddrinfo|timeout expired|Connection terminated/i.test(msg)
  )
}

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) {
    return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  }
  const userAgent = req.headers.get('user-agent') || ''
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || ''
  try {
    await ensureSchema()
  } catch (e) {
    console.error('[auth/login] ensureSchema', e)
    if (isDatabaseConnectivityError(e)) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  try {
    const { login_id, password } = (await req.json()) as { login_id?: string; password?: string }
    if (!login_id || !password) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
    }
    const { rows } = await pool.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM aaelink.users
       WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
      [String(login_id).trim()]
    )
    const row = rows[0]
    if (!row || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
    }
    const sessionId = randomUUID()
    const now = Date.now()
    const expiresAt = now + SESSION_MS
    await pool.query(
      `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, row.id, expiresAt, userAgent, ipAddress, now]
    )
    // Mark user as online immediately (don't wait for the first heartbeat)
    await pool.query(
      `UPDATE aaelink.users SET last_seen_at = $1 WHERE id = $2`,
      [now, row.id]
    )
    const u = await pool.query(
      `SELECT id, username, email, first_name, last_name, nickname, platform_role, avatar_url, job_title, phone, timezone, status_text, status_emoji FROM aaelink.users WHERE id = $1`,
      [row.id]
    )
    const user = u.rows[0]
    const res = NextResponse.json({ user })
    res.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: sessionCookieSecure(),
      path: '/',
      maxAge: Math.floor(SESSION_MS / 1000)
    })
    return res
  } catch (e) {
    console.error('[auth/login]', e)
    if (isDatabaseConnectivityError(e)) {
      return NextResponse.json({ error: 'database_unavailable' }, { status: 503 })
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
