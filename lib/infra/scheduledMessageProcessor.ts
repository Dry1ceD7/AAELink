import { getPool } from '@/lib/infra/db'
import { randomUUID } from 'crypto'
import { log } from '@/lib/infra/log'

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
      const msgId = randomUUID()
      const createAt = Number(row.send_at)

      // Insert into the regular messages table
      await pool.query(
        `INSERT INTO aaelink.messages (id, channel_id, user_id, body, created_at, updated_at, root_id)
         VALUES ($1, $2, $3, $4, $5, $5, $6)`,
        [msgId, row.channel_id, row.user_id, row.body, createAt, row.root_id || '']
      )

      // Update the channel's last_post_at
      await pool.query(
        `UPDATE aaelink.channels SET last_post_at = GREATEST(last_post_at, $1) WHERE id = $2`,
        [createAt, row.channel_id]
      )

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
