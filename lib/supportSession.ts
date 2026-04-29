import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { sessionCookieSecure } from '@/lib/session'

export const SUPPORT_SESSION_COOKIE = 'AAELINK_SUPPORT_SESSION'

const SUPPORT_SESSION_MS = 8 * 60 * 60 * 1000

export function supportSessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: sessionCookieSecure(),
    path: '/',
    maxAge: Math.floor(SUPPORT_SESSION_MS / 1000)
  }
}

export function setSupportSessionCookie(res: NextResponse, sessionId: string) {
  res.cookies.set(SUPPORT_SESSION_COOKIE, sessionId, supportSessionCookieOptions())
}

export function clearSupportSessionCookie(res: NextResponse) {
  res.cookies.set(SUPPORT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    maxAge: 0
  })
}

/** Returns user id if support OTP session is valid, else null. */
export async function readSupportVerifiedUserId(): Promise<string | null> {
  const sid = (await cookies()).get(SUPPORT_SESSION_COOKIE)?.value?.trim()
  if (!sid) return null
  const pool = getPool()
  if (!pool) return null
  await ensureSchema()
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.support_contact_sessions WHERE id = $1 AND expires_at > $2`,
    [sid, Date.now()]
  )
  return rows[0]?.user_id ?? null
}

export async function createSupportContactSession(userId: string): Promise<string> {
  const pool = getPool()
  if (!pool) throw new Error('no_pool')
  await ensureSchema()
  const id = randomBytes(24).toString('hex')
  const now = Date.now()
  const exp = now + SUPPORT_SESSION_MS
  await pool.query(`DELETE FROM aaelink.support_contact_sessions WHERE user_id = $1`, [userId])
  await pool.query(
    `INSERT INTO aaelink.support_contact_sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [id, userId, now, exp]
  )
  return id
}

export async function revokeSupportContactSessionsForUser(userId: string) {
  const pool = getPool()
  if (!pool) return
  await ensureSchema()
  await pool.query(`DELETE FROM aaelink.support_contact_sessions WHERE user_id = $1`, [userId]).catch(() => { })
}

export async function revokeSupportContactSessionByCookieId(sessionId: string) {
  const pool = getPool()
  if (!pool) return
  await ensureSchema()
  await pool.query(`DELETE FROM aaelink.support_contact_sessions WHERE id = $1`, [sessionId]).catch(() => { })
}
