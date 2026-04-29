import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { notifySupportEmergencyStaff } from '@/lib/notificationsServer'
import { readSessionUserId } from '@/lib/session'
import { readSupportVerifiedUserId } from '@/lib/supportSession'

const MAX_BODY = 4000

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supportUid = await readSupportVerifiedUserId()
  if (supportUid !== userId) {
    return NextResponse.json({ error: 'support_verification_required' }, { status: 403 })
  }

  let body: { message?: string }
  try {
    body = (await req.json()) as { message?: string }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const text = String(body.message || '').trim()
  if (text.length < 10) return NextResponse.json({ error: 'message_too_short' }, { status: 400 })
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'message_too_long' }, { status: 400 })

  const id = randomBytes(12).toString('hex')
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.support_emergency_messages (id, user_id, body, created_at, status) VALUES ($1, $2, $3, $4, 'open')`,
    [id, userId, text, now]
  )
  const { rows: ur } = await pool.query<{ username: string }>(`SELECT username FROM aaelink.users WHERE id = $1`, [userId])
  const username = ur[0]?.username?.trim() || 'user'
  await notifySupportEmergencyStaff({
    pool,
    reporterUserId: userId,
    reporterUsername: username,
    emergencyId: id,
    body: text
  }).catch(err => {
    console.error('[support emergency notify]', err)
  })
  return NextResponse.json({ ok: true, id })
}
