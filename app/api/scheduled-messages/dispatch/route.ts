import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { applyDlpToMessage } from '@/lib/enterprise/dlpInterceptor'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Scheduled Messages Dispatcher — POST /api/scheduled-messages/dispatch
 *
 * Finds all pending scheduled messages whose `send_at` has passed, inserts
 * them into `aaelink.messages`, and marks them as `sent`.
 *
 * Intended to be called periodically (e.g. every 30s from a client-side
 * setInterval, or from an external cron hitting this endpoint).
 *
 * Returns the count of dispatched messages.
 */
async function _POST() {
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

      const messageId = randomUUID()
      const sendTime = Number(msg.send_at) || now

      // Insert the actual message
      await pool.query(
        `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [messageId, msg.channel_id, msg.user_id, deliverBody, msg.root_id || '', sendTime]
      )

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
