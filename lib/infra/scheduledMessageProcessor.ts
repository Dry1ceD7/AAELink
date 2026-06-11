import { getPool } from '@/lib/infra/db'
import { log } from '@/lib/infra/log'
import { applyDlpToMessage } from '@/lib/enterprise/dlpInterceptor'
import { isChannelArchived, userCanPostToChannel } from '@/lib/enterprise/collab-access'
import { deliverScheduledMessage } from '@/lib/messaging/deliverScheduledMessage'

/**
 * Scheduled Message Processor — sends messages that have reached their send_at time.
 *
 * This runs on a 10-second interval inside the Next.js server process.
 * In production, this would be an external worker or cron job.
 *
 * Flow:
 *   1. Query all pending messages where send_at ≤ now
 *   2. Insert them into aaelink.messages (the regular message table)
 *   3. Update status to 'sent'
 */

let running = false

async function processScheduledMessages(): Promise<number> {
  const pool = getPool()
  if (!pool) return 0

  const now = Date.now()

  // Fetch due messages
  const { rows } = await pool.query<{
    id: string; channel_id: string; user_id: string; body: string; root_id: string; send_at: string
  }>(
    `SELECT id, channel_id, user_id, body, root_id, send_at
     FROM aaelink.scheduled_messages
     WHERE status = 'pending' AND send_at <= $1
     ORDER BY send_at ASC
     LIMIT 50`,
    [now]
  )

  if (rows.length === 0) return 0

  let sent = 0
  for (const row of rows) {
    try {
      // Re-check archived state and posting permission at send time —
      // channel may have been archived or restricted since scheduling.
      if (await isChannelArchived(pool, row.channel_id)) {
        await pool.query(
          `UPDATE aaelink.scheduled_messages SET status = 'failed' WHERE id = $1`,
          [row.id]
        )
        log.error('[scheduledMessages] channel archived, skipping scheduled message', { id: row.id })
        continue
      }
      if (!(await userCanPostToChannel(pool, row.user_id, row.channel_id))) {
        await pool.query(
          `UPDATE aaelink.scheduled_messages SET status = 'failed' WHERE id = $1`,
          [row.id]
        )
        log.error('[scheduledMessages] user lost post permission, skipping scheduled message', { id: row.id })
        continue
      }

      // DLP check before delivery — block by marking status='blocked', redact by inserting masked body.
      const dlp = await applyDlpToMessage({ content: row.body, userId: row.user_id, channelId: row.channel_id })
      if (!dlp.allowed) {
        await pool.query(
          `UPDATE aaelink.scheduled_messages SET status = 'blocked' WHERE id = $1`,
          [row.id]
        )
        log.error('[scheduledMessages] DLP blocked scheduled message', { id: row.id })
        continue
      }
      const deliverBody = dlp.content
      const createAt = Number(row.send_at)

      // Insert + run the full post-insert side-effect set (notifications,
      // thread-follower fan-out, realtime emit, webhook emit, last_post_at) via
      // the shared helper that BOTH delivery paths use. This processor is the
      // primary production sender, so it MUST mirror the live POST path.
      await deliverScheduledMessage(pool, {
        channelId: row.channel_id,
        userId: row.user_id,
        body: deliverBody,
        rootId: row.root_id || '',
        createdAt: createAt,
      })

      // Mark as sent
      await pool.query(
        `UPDATE aaelink.scheduled_messages SET status = 'sent', sent_at = $1 WHERE id = $2`,
        [now, row.id]
      )

      sent++
    } catch (err: unknown) {
      log.error('failed to send scheduled message', {
        name: 'scheduledMessages.process',
        message_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      })
      // Don't mark as sent — will retry on next tick
    }
  }

  return sent
}

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the scheduled message processor loop.
 * Safe to call multiple times — only one instance runs.
 */
export function startScheduledMessageProcessor(): void {
  if (running) return
  running = true

  // Process every 10 seconds
  intervalId = setInterval(() => {
    void processScheduledMessages()
  }, 10_000)

  // Also run once immediately
  void processScheduledMessages()
}

/**
 * Stop the processor (for graceful shutdown).
 */
export function stopScheduledMessageProcessor(): void {
  running = false
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
