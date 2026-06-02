// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Email Notification Dispatch API.
 *
 * POST /api/notifications/email — trigger email notification for a user.
 *
 * This endpoint queues email notifications. In production, a worker
 * consumes the queue and sends via configured SMTP/Resend/SES.
 *
 * Currently supports:
 *   - mention: someone mentioned you
 *   - dm: new direct message
 *   - thread_reply: reply in a thread you follow
 *   - channel_invite: invited to a channel
 *   - system: system announcements
 *
 * The user's notification preferences are checked before queuing.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    recipient_id?: string
    type?: string
    subject?: string
    body_text?: string
    body_html?: string
    metadata?: Record<string, unknown>
  }

  const recipientId = String(body.recipient_id || '').trim()
  const type = String(body.type || '').trim()
  const subject = String(body.subject || '').trim()
  const bodyText = String(body.body_text || '').trim()
  const bodyHtml = String(body.body_html || '').trim()

  if (!recipientId) return NextResponse.json({ error: 'recipient_id_required' }, { status: 400 })
  if (!type) return NextResponse.json({ error: 'type_required' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'subject_required' }, { status: 400 })

  // Check recipient exists and get their email + notification prefs
  const { rows: userRows } = await pool.query<{
    email: string; notification_prefs: string
  }>(`SELECT email, COALESCE(notification_prefs, '{}') AS notification_prefs
      FROM aaelink.users WHERE id = $1`, [recipientId])

  if (!userRows[0]) return NextResponse.json({ error: 'recipient_not_found' }, { status: 404 })
  const recipient = userRows[0]

  if (!recipient.email) {
    return NextResponse.json({ error: 'recipient_has_no_email', queued: false })
  }

  // Check notification preferences
  let prefs: Record<string, unknown> = {}
  try {
    prefs = typeof recipient.notification_prefs === 'string'
      ? JSON.parse(recipient.notification_prefs)
      : recipient.notification_prefs
  } catch { /* default empty */ }

  const emailEnabled = prefs.email !== false
  if (!emailEnabled) {
    return NextResponse.json({ ok: true, queued: false, reason: 'email_notifications_disabled' })
  }

  // Queue the email notification
  const { randomUUID } = await import('crypto')
  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.email_queue
      (id, recipient_id, recipient_email, type, subject, body_text, body_html, metadata, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
  `, [id, recipientId, recipient.email, type, subject, bodyText, bodyHtml,
      JSON.stringify(body.metadata || {}), now])

  return NextResponse.json({
    ok: true,
    queued: true,
    email_id: id,
    recipient_email: recipient.email.replace(/(.{2}).+(@.+)/, '$1***$2')  // mask email
  })
}

/** GET — list queued/sent emails (admin only, for monitoring) */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Admin check
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = uRows[0]?.platform_role || ''
  if (!['super_admin', 'platform_admin'].includes(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const status = req.nextUrl.searchParams.get('status') || 'pending'
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 200)

  const { rows } = await pool.query(`
    SELECT eq.id, eq.recipient_id, eq.recipient_email, eq.type, eq.subject,
           eq.status, eq.created_at, eq.sent_at, eq.error,
           u.username AS recipient_username
    FROM aaelink.email_queue eq
    LEFT JOIN aaelink.users u ON u.id = eq.recipient_id
    WHERE eq.status = $1
    ORDER BY eq.created_at DESC
    LIMIT $2
  `, [status, limit])

  return NextResponse.json({ emails: rows, count: rows.length })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/notifications/email', _GET)
export const POST   = tracedRoute('POST', '/api/notifications/email', _POST)
