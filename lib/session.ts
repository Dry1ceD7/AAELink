import { cookies } from 'next/headers'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'

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
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.sessions WHERE id = $1 AND expires_at > $2`,
    [sid, Date.now()]
  )
  return rows[0]?.user_id ?? null
}
