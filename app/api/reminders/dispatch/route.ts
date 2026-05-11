import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Reminder Dispatcher — POST /api/reminders/dispatch
 *
 * Finds all pending reminders whose fire_at has passed, creates a
 * notification for each, and marks them as 'fired'.
 *
 * Called periodically from the presence heartbeat (same as scheduled messages).
 */
async function _POST() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const now = Date.now()

  const { rows: due } = await pool.query<{
    id: string
    user_id: string
    body: string
    message_id: string
    channel_id: string
  }>(
    `SELECT id, user_id, body, message_id, channel_id
     FROM aaelink.reminders
     WHERE status = 'pending' AND fire_at <= $1
     ORDER BY fire_at ASC
     LIMIT 50`,
    [now]
  )

  if (due.length === 0) {
    return NextResponse.json({ dispatched: 0 })
  }

  let dispatched = 0

  for (const r of due) {
    try {
      const notifId = randomUUID()
      const title = '⏰ Reminder'
      const notifBody = r.body || 'You set a reminder for a message.'
      // Create an in-app notification
      await pool.query(
        `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, href, created_at)
         VALUES ($1, $2, 'reminder', $3, $4, $5, $6)`,
        [
          notifId,
          r.user_id,
          title,
          notifBody,
          r.channel_id ? `/home?channel_id=${r.channel_id}${r.message_id ? `&focus_msg=${r.message_id}` : ''}` : '',
          now
        ]
      )
      // Mark as fired
      await pool.query(
        `UPDATE aaelink.reminders SET status = 'fired', fired_at = $1 WHERE id = $2`,
        [now, r.id]
      )
      dispatched++
    } catch (err: unknown) {
      console.error(`[reminders-dispatch] Failed ${r.id}:`, err)
      await pool.query(
        `UPDATE aaelink.reminders SET status = 'failed' WHERE id = $1`,
        [r.id]
      ).catch(() => {})
    }
  }

  return NextResponse.json({ dispatched })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/reminders/dispatch', _POST)
