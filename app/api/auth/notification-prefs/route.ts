import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { getNotificationPrefsForUser, normalizeDigestFrequency } from '@/lib/notifications/notificationPrefs'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const prefs = await getNotificationPrefsForUser(pool, uid)
  return NextResponse.json(prefs)
}

async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as {
    mentions_enabled?: unknown
    ticket_activity_enabled?: unknown
    system_notifications_enabled?: unknown
    digest_frequency?: unknown
  }
  const cur = await getNotificationPrefsForUser(pool, uid)
  let mentions = cur.mentions_enabled
  let ticketAct = cur.ticket_activity_enabled
  let systemN = cur.system_notifications_enabled
  let digest = cur.digest_frequency
  if (typeof body.mentions_enabled === 'boolean') mentions = body.mentions_enabled
  if (typeof body.ticket_activity_enabled === 'boolean') ticketAct = body.ticket_activity_enabled
  if (typeof body.system_notifications_enabled === 'boolean') systemN = body.system_notifications_enabled
  // Validate digest_frequency strictly: a bad value is a 400, not a silent reset.
  if (body.digest_frequency !== undefined) {
    if (!['off', 'hourly', 'daily', 'weekly'].includes(String(body.digest_frequency))) {
      return NextResponse.json({ error: 'invalid_digest_frequency' }, { status: 400 })
    }
    digest = normalizeDigestFrequency(body.digest_frequency)
  }
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.user_notification_prefs (user_id, mentions_enabled, ticket_activity_enabled, system_notifications_enabled, digest_frequency, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       mentions_enabled = EXCLUDED.mentions_enabled,
       ticket_activity_enabled = EXCLUDED.ticket_activity_enabled,
       system_notifications_enabled = EXCLUDED.system_notifications_enabled,
       digest_frequency = EXCLUDED.digest_frequency,
       updated_at = EXCLUDED.updated_at`,
    [uid, mentions, ticketAct, systemN, digest, now]
  )
  return NextResponse.json({
    mentions_enabled: mentions,
    ticket_activity_enabled: ticketAct,
    system_notifications_enabled: systemN,
    digest_frequency: digest
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/auth/notification-prefs', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/auth/notification-prefs', _PATCH)
