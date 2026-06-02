import { cookies } from 'next/headers'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'

export const SESSION_COOKIE = 'AAELINK_SESSION'

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
  const { rows } = await pool.query<{ user_id: string; last_active_at: number }>(
    `SELECT user_id, last_active_at FROM aaelink.sessions WHERE id = $1 AND expires_at > $2`,
    [sid, Date.now()]
  )
  const uid = rows[0]?.user_id ?? null
  if (uid) {
    // Debounced touch: only update last_active_at if it's been > 5 minutes
    const last = rows[0]?.last_active_at ?? 0
    if (Date.now() - last > 300_000) {
      pool.query(
        `UPDATE aaelink.sessions SET last_active_at = $1 WHERE id = $2`,
        [Date.now(), sid]
      ).catch(() => { /* non-critical */ })
    }
  }
  return uid
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
  const { rows } = await pool.query<{ user_id: string; last_active_at: number }>(
    `SELECT user_id, last_active_at FROM aaelink.sessions WHERE id = $1 AND expires_at > $2`,
    [sid, Date.now()]
  )
  const uid = rows[0]?.user_id ?? null
  if (uid) {
    const last = rows[0]?.last_active_at ?? 0
    if (Date.now() - last > 300_000) {
      pool.query(
        `UPDATE aaelink.sessions SET last_active_at = $1 WHERE id = $2`,
        [Date.now(), sid]
      ).catch(() => { /* non-critical */ })
    }
  }
  return uid
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
