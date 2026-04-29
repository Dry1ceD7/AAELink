import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/session'
import {
  SUPPORT_SESSION_COOKIE,
  clearSupportSessionCookie,
  revokeSupportContactSessionByCookieId
} from '@/lib/supportSession'

export async function POST() {
  const pool = getPool()
  const jar = await cookies()
  const sid = jar.get(SESSION_COOKIE)?.value
  const supportSid = jar.get(SUPPORT_SESSION_COOKIE)?.value?.trim()
  if (pool && supportSid) {
    await ensureSchema()
    await revokeSupportContactSessionByCookieId(supportSid)
  }
  if (pool && sid) {
    await ensureSchema()
    await pool.query(`DELETE FROM aaelink.sessions WHERE id = $1`, [sid]).catch(() => { })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(),
    path: '/',
    maxAge: 0
  })
  clearSupportSessionCookie(res)
  return res
}
