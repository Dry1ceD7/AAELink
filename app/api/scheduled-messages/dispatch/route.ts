import { NextRequest, NextResponse } from 'next/server'
import { applyDlpToMessage } from '@/lib/enterprise/dlpInterceptor'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { isChannelArchived, userCanPostToChannel } from '@/lib/enterprise/collab-access'
import { readSessionUserId } from '@/lib/auth/session'
import { deliverScheduledMessage } from '@/lib/messaging/deliverScheduledMessage'

/**
 * Scheduled Messages Dispatcher — POST /api/scheduled-messages/dispatch
 *
 * Finds all pending scheduled messages whose `send_at` has passed, inserts
 * them into `aaelink.messages`, and marks them as `sent`.
 *
 * This endpoint is INTERNAL — callers must present either:
 *   1. A valid platform_admin or super_admin session cookie, OR
 *   2. A matching `x-dispatch-secret` header (value = DISPATCH_SECRET env var,
 *      when the env var is set).
 *
 * Returns the count of dispatched messages.
 */
async function _POST(req: NextRequest) {
  // ── Authentication guard ────────────────────────────────────────────
  // Option 1: shared secret (used by external cron / worker process).
  const dispatchSecret = process.env.DISPATCH_SECRET?.trim()
  const headerSecret = req.headers.get('x-dispatch-secret')?.trim()
  const secretOk = dispatchSecret && headerSecret && headerSecret === dispatchSecret

  if (!secretOk) {
    // Option 2: authenticated platform_admin / super_admin session.
    await ensureSchema()
    const uid = await readSessionUserId()
    if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
    const { rows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`,
      [uid]
    )
    const role = rows[0]?.platform_role
    if (role !== 'platform_admin' && role !== 'super_admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const now = Date.now()

  // Find all pending scheduled messages whose send_at has passed
  const { rows: due } = await pool.query<{
    id: string
    channel_id: string
    user_id: string
    body: string
    root_id: string
    send_at: string
  }>(
    `SELECT id, channel_id, user_id, body, root_id, send_at
     FROM aaelink.scheduled_messages
     WHERE status = 'pending' AND send_at <= $1
     ORDER BY send_at ASC
     LIMIT 50`,
    [now]
  )

  if (due.length === 0) {
    return NextResponse.json({ dispatched: 0 })
  }

  let dispatched = 0

  for (const msg of due) {
    try {
      // Re-check archived state and posting permission at send time —
      // channel may have been archived or restricted since scheduling.
      if (await isChannelArchived(pool, msg.channel_id)) {
        await pool.query(
          `UPDATE aaelink.scheduled_messages SET status = 'failed' WHERE id = $1`,
          [msg.id]
        ).catch(() => { /* ignore */ })
        continue
      }
      if (!(await userCanPostToChannel(pool, msg.user_id, msg.channel_id))) {
        await pool.query(
          `UPDATE aaelink.scheduled_messages SET status = 'failed' WHERE id = $1`,
          [msg.id]
        ).catch(() => { /* ignore */ })
        continue
      }

      // DLP check before delivery — block by marking status='blocked', redact by inserting masked body.
      const dlp = await applyDlpToMessage({ content: msg.body, userId: msg.user_id, channelId: msg.channel_id })
      if (!dlp.allowed) {
        await pool.query(
          `UPDATE aaelink.scheduled_messages SET status = 'blocked' WHERE id = $1`,
          [msg.id]
        ).catch(() => { /* ignore */ })
        continue
      }
      const deliverBody = dlp.content
      const sendTime = Number(msg.send_at) || now

      // Insert + run the full post-insert side-effect set (notifications,
      // thread-follower fan-out, realtime emit, webhook emit, last_post_at) via
      // the shared helper that BOTH delivery paths use.
      await deliverScheduledMessage(pool, {
        channelId: msg.channel_id,
        userId: msg.user_id,
        body: deliverBody,
        rootId: msg.root_id || '',
        createdAt: sendTime,
      })

      // Mark the scheduled message as sent
      await pool.query(
        `UPDATE aaelink.scheduled_messages
         SET status = 'sent', sent_at = $1
         WHERE id = $2 AND status = 'pending'`,
        [now, msg.id]
      )

      dispatched++
    } catch (err: unknown) {
      // If insertion fails (e.g. channel deleted), mark as failed
      console.error(`[scheduled-dispatch] Failed to send ${msg.id}:`, err)
      await pool.query(
        `UPDATE aaelink.scheduled_messages SET status = 'failed' WHERE id = $1`,
        [msg.id]
      ).catch(() => { /* ignore */ })
    }
  }

  return NextResponse.json({ dispatched })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/scheduled-messages/dispatch', _POST)
