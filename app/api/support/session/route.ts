import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  SUPPORT_SESSION_COOKIE,
  clearSupportSessionCookie,
  readSupportVerifiedUserId,
  revokeSupportContactSessionByCookieId
} from '@/lib/auth/supportSession'

/** Returns whether the current browser has a valid support (IT contact) verification. */
async function _GET() {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ verified: false as const })
  const v = await readSupportVerifiedUserId()
  return NextResponse.json({ verified: v === uid })
}

async function _DELETE() {
  const sid = (await cookies()).get(SUPPORT_SESSION_COOKIE)?.value?.trim()
  if (sid) await revokeSupportContactSessionByCookieId(sid)
  const res = NextResponse.json({ ok: true })
  clearSupportSessionCookie(res)
  return res
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/support/session', _GET)
export const DELETE = tracedRoute('DELETE', '/api/support/session', _DELETE)
