import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { verifyPassword } from '@/lib/auth/password'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

// ── Rate limiting (in-memory per IP) ─────────────────────────────────────────
const loginAttempts = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 10

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now })
    return { allowed: true }
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSec: retryAfter }
  }

  entry.count++
  return { allowed: true }
}

// Cleanup stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of loginAttempts.entries()) {
      if (now - entry.windowStart > RATE_WINDOW_MS) loginAttempts.delete(ip)
    }
  }, 5 * 60 * 1000)
}

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

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) {
    return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  }

  const userAgent = req.headers.get('user-agent') || ''
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || '127.0.0.1'

  // Rate limit check
  const rateCheck = checkRateLimit(ipAddress)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'too_many_attempts', retry_after_seconds: rateCheck.retryAfterSec },
      {
        status: 429,
        headers: { 'Retry-After': String(rateCheck.retryAfterSec || 60) }
      }
    )
  }

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
      // Audit failed login
      try {
        await pool.query(
          `INSERT INTO aaelink.audit_log (id, actor_id, action, entity_type, entity_id, ip_address, user_agent, meta, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            row?.id || 'unknown',
            'user.login_failed',
            'user',
            row?.id || 'unknown',
            ipAddress,
            userAgent,
            JSON.stringify({ login_id: String(login_id).trim(), reason: row ? 'bad_password' : 'user_not_found' }),
            Date.now()
          ]
        )
      } catch { /* best-effort */ }
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
    // Mark user as online + track login activity
    await pool.query(
      `UPDATE aaelink.users SET last_seen_at = $1, last_login_at = $1,
              login_count = COALESCE(login_count, 0) + 1 WHERE id = $2`,
      [now, row.id]
    )

    // Audit successful login
    try {
      await pool.query(
        `INSERT INTO aaelink.audit_log (id, actor_id, action, entity_type, entity_id, ip_address, user_agent, meta, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [randomUUID(), row.id, 'user.login', 'user', row.id, ipAddress, userAgent, JSON.stringify({ session_id: sessionId }), now]
      )
    } catch { /* best-effort */ }

    // Reset rate limit on success
    loginAttempts.delete(ipAddress)

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

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/auth/login', _POST)
