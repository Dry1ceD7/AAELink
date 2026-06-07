import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import type { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { getSessionPolicy, isIdleExpired, sessionTtlMs } from '@/lib/auth/sessionPolicy'
import { enforceSessionLimits, isAuthStale } from '@/lib/auth/sessionEnforcement'

export const SESSION_COOKIE = 'AAELINK_SESSION'

/**
 * Validate a session row against the active session policy and apply the
 * debounced last-active touch. Returns the user id, or null when the session is
 * idle-expired (D2 idle timeout, off by default). expires_at is already enforced
 * by the SQL filter at the call site.
 */
async function resolveActiveSession(
  pool: Pool,
  sid: string,
  row: { user_id: string; last_active_at: number; created_at: number } | undefined
): Promise<string | null> {
  if (!row) return null
  const now = Date.now()
  // getSessionPolicy returns DEFAULT_SESSION_POLICY when no row is stored (fail
  // open on ABSENT policy). A DB error propagates here intentionally — this is a
  // security gate, so we never treat a failed read as "no policy".
  const policy = await getSessionPolicy(pool, now)
  if (isIdleExpired(policy, row.last_active_at ?? 0, now, row.created_at ?? 0)) return null
  // force_reauth_hours: reject a session older than N hours since auth, regardless
  // of activity. Disabled when force_reauth_hours <= 0.
  if (isAuthStale(policy, row.created_at ?? 0, now)) return null

  // Debounced touch: only update last_active_at if it's been > 5 minutes.
  if (now - (row.last_active_at ?? 0) > 300_000) {
    pool.query(
      `UPDATE aaelink.sessions SET last_active_at = $1 WHERE id = $2`,
      [now, sid]
    ).catch(() => { /* non-critical */ })
  }
  return row.user_id
}

/**
 * Use `Secure` session cookies when the public URL is HTTPS (dev LAN HTTPS or production).
 * If production is served over `http://`, browsers would ignore `Secure: true`, so sign-in would fail.
 */
export function sessionCookieSecure(): boolean {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || ''
  if (base.startsWith('https://')) return true
  if (base.startsWith('http://')) return false
  if (process.env.NODE_ENV !== 'production') return false
  return process.env.AAELINK_SESSION_COOKIE_SECURE === '1'
}

/** Resolves signed-in user id from opaque session cookie, or null. */
export async function readSessionUserId(): Promise<string | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value?.trim()
  if (!sid) return null
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  const { rows } = await pool.query<{ user_id: string; last_active_at: number; created_at: number }>(
    `SELECT user_id, last_active_at, created_at FROM aaelink.sessions WHERE id = $1 AND expires_at > $2 AND mfa_pending = false`,
    [sid, Date.now()]
  )
  return resolveActiveSession(pool, sid, rows[0])
}

/**
 * Variant of `readSessionUserId` that takes a raw `Cookie:` header string, for
 * code paths that run outside the Next.js request context (the WS gateway boot
 * script, custom Node servers). Same database lookup; same `expires_at` gate;
 * same debounced touch.
 */
export async function readSessionUserIdFromCookieHeader(
  cookieHeader: string
): Promise<string | null> {
  const sid = parseCookieValue(cookieHeader, SESSION_COOKIE)?.trim()
  if (!sid) return null
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  const { rows } = await pool.query<{ user_id: string; last_active_at: number; created_at: number }>(
    `SELECT user_id, last_active_at, created_at FROM aaelink.sessions WHERE id = $1 AND expires_at > $2 AND mfa_pending = false`,
    [sid, Date.now()]
  )
  return resolveActiveSession(pool, sid, rows[0])
}

/**
 * Read the session that is awaiting MFA step-up (mfa_pending = true), if any.
 * Used only by the step-up route: `readSessionUserId` deliberately hides these
 * sessions from every other route. Returns the user id + session id, or null.
 */
export async function readMfaPendingSession(): Promise<{ userId: string; sessionId: string } | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value?.trim()
  if (!sid) return null
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.sessions
      WHERE id = $1 AND expires_at > $2 AND mfa_pending = true`,
    [sid, Date.now()]
  )
  if (!rows[0]) return null
  return { userId: rows[0].user_id, sessionId: sid }
}

/**
 * Create a fully-usable (non-pending) session for a user and return its id +
 * lifetime. Used by login paths that establish a session directly (passwordless
 * WebAuthn login); mirrors the session row password + SSO login write.
 */
export async function createSession(
  pool: Pool,
  userId: string,
  meta: { ip: string; userAgent: string }
): Promise<{ sessionId: string; sessionMs: number }> {
  const now = Date.now()
  const sessionId = randomUUID()
  const policy = await getSessionPolicy(pool, now)
  const sessionMs = sessionTtlMs(policy, 'web')
  await pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [sessionId, userId, now + sessionMs, meta.userAgent, meta.ip, now]
  )
  // Enforce max_sessions_per_user / single_session_mode now that the new session
  // exists. Best-effort: a cap-eviction failure must not break a valid login.
  await enforceSessionLimits(pool, userId, policy, sessionId, now).catch(() => { /* non-critical */ })
  return { sessionId, sessionMs }
}

/** Clear the MFA step-up gate on a session, promoting it to fully usable. */
export async function clearMfaPending(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE aaelink.sessions SET mfa_pending = false WHERE id = $1`,
    [sessionId]
  )
}

/** Pull a single cookie value out of an HTTP `Cookie:` header. Returns null when absent. */
function parseCookieValue(header: string, name: string): string | null {
  if (!header) return null
  const parts = header.split(/;\s*/)
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}
