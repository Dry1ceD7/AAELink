import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { readSessionUserId } from '@/lib/session'
import {
  SUPPORT_SESSION_COOKIE,
  clearSupportSessionCookie,
  readSupportVerifiedUserId,
  revokeSupportContactSessionByCookieId
} from '@/lib/supportSession'

/** Returns whether the current browser has a valid support (IT contact) verification. */
export async function GET() {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ verified: false as const })
  const v = await readSupportVerifiedUserId()
  return NextResponse.json({ verified: v === uid })
}

export async function DELETE() {
  const sid = (await cookies()).get(SUPPORT_SESSION_COOKIE)?.value?.trim()
  if (sid) await revokeSupportContactSessionByCookieId(sid)
  const res = NextResponse.json({ ok: true })
  clearSupportSessionCookie(res)
  return res
}
