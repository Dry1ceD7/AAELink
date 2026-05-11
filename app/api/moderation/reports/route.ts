import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Content Moderation / Message Flagging API.
 *
 * POST   /api/moderation/reports           — flag a message or user
 * GET    /api/moderation/reports           — admin: list pending reports
 * PATCH  /api/moderation/reports           — admin: review/resolve a report
 *
 * Report reasons: spam, harassment, inappropriate, misinformation, other
 * Actions: dismiss, warn, delete_message, deactivate_user
 */

/** POST — report/flag a message or user */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    message_id?: string
    reported_user_id?: string
    channel_id?: string
    reason?: string
    details?: string
  }

  const messageId = String(body.message_id || '').trim()
  const reportedUserId = String(body.reported_user_id || '').trim()
  const channelId = String(body.channel_id || '').trim()
  const reason = String(body.reason || '').trim()
  const details = String(body.details || '').trim()

  if (!messageId && !reportedUserId) {
    return NextResponse.json({ error: 'message_id_or_reported_user_id_required' }, { status: 400 })
  }
  if (!['spam', 'harassment', 'inappropriate', 'misinformation', 'other'].includes(reason)) {
    return NextResponse.json({ error: 'invalid_reason' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()

  // If reporting a message, get the author
  let targetUserId = reportedUserId
  if (messageId && !targetUserId) {
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.messages WHERE id = $1`, [messageId]
    )
    targetUserId = rows[0]?.user_id || ''
  }

  await pool.query(`
    INSERT INTO aaelink.moderation_reports
      (id, reporter_id, message_id, reported_user_id, channel_id, reason, details, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
  `, [id, uid, messageId || null, targetUserId || null, channelId || null, reason, details, now])

  return NextResponse.json({ report: { id, status: 'pending', created_at: now } })
}

/** GET — admin: list moderation reports */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const status = req.nextUrl.searchParams.get('status')?.trim() || 'pending'
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 200)

  const { rows } = await pool.query(`
    SELECT r.*,
           reporter.username AS reporter_username,
           reported.username AS reported_username,
           m.body AS message_body,
           c.name AS channel_name, c.display_name AS channel_display
    FROM aaelink.moderation_reports r
    LEFT JOIN aaelink.users reporter ON reporter.id = r.reporter_id
    LEFT JOIN aaelink.users reported ON reported.id = r.reported_user_id
    LEFT JOIN aaelink.messages m ON m.id = r.message_id
    LEFT JOIN aaelink.channels c ON c.id = r.channel_id
    WHERE r.status = $1
    ORDER BY r.created_at DESC
    LIMIT $2
  `, [status, limit])

  // Get counts per status
  const { rows: counts } = await pool.query<{ status: string; count: string }>(`
    SELECT status, COUNT(*)::text AS count
    FROM aaelink.moderation_reports
    GROUP BY status
  `)

  return NextResponse.json({
    reports: rows,
    counts: Object.fromEntries(counts.map(c => [c.status, Number(c.count)]))
  })
}

/** PATCH — admin: review and resolve a report */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    report_id?: string
    action?: string
    resolution_notes?: string
  }

  const reportId = String(body.report_id || '').trim()
  const action = String(body.action || '').trim()
  const notes = String(body.resolution_notes || '').trim()

  if (!reportId) return NextResponse.json({ error: 'report_id_required' }, { status: 400 })
  if (!['dismiss', 'warn', 'delete_message', 'deactivate_user'].includes(action)) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }

  const now = Date.now()

  // Get report details
  const { rows: reportRows } = await pool.query<{
    message_id: string | null
    reported_user_id: string | null
  }>(`SELECT message_id, reported_user_id FROM aaelink.moderation_reports WHERE id = $1`, [reportId])

  if (!reportRows[0]) return NextResponse.json({ error: 'report_not_found' }, { status: 404 })
  const report = reportRows[0]

  // Execute action
  if (action === 'delete_message' && report.message_id) {
    await pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [report.message_id])
  }
  if (action === 'deactivate_user' && report.reported_user_id) {
    await pool.query(`UPDATE aaelink.users SET deactivated_at = $1 WHERE id = $2`, [now, report.reported_user_id])
  }

  // Update report status
  await pool.query(`
    UPDATE aaelink.moderation_reports
    SET status = 'resolved', action_taken = $2, resolution_notes = $3,
        resolved_by = $4, resolved_at = $5
    WHERE id = $1
  `, [reportId, action, notes, uid, now])

  // Audit log
  try {
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, action, resource_id, metadata, created_at)
      VALUES ($1, $2, 'moderation.resolve', $3, $4, $5)
    `, [randomUUID(), uid, reportId, JSON.stringify({ action, message_id: report.message_id }), now])
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, action, resolved_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/moderation/reports', _GET)
export const POST   = tracedRoute('POST', '/api/moderation/reports', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/moderation/reports', _PATCH)
