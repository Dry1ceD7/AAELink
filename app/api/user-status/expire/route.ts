import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/user-status/expire
 * 
 * Cron-style endpoint that clears expired custom statuses.
 * Should be called periodically (e.g., every 60s by a client-side timer
 * or a server-side cron job).
 * 
 * Clears status_text, status_emoji on the users table, and resets
 * custom_text and expires_at on user_status for any user whose
 * expires_at > 0 and expires_at <= now.
 */
async function _POST() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const now = Date.now()

  // Find users with expired custom statuses
  const { rows } = await pool.query(
    `SELECT user_id FROM aaelink.user_status
     WHERE expires_at > 0 AND expires_at <= $1`,
    [now]
  )

  if (rows.length === 0) {
    return NextResponse.json({ cleared: 0 })
  }

  const expiredUserIds = (rows as { user_id: string }[]).map(r => r.user_id)

  // Clear status_text and status_emoji on users table
  await pool.query(
    `UPDATE aaelink.users SET status_text = '', status_emoji = ''
     WHERE id = ANY($1::uuid[])`,
    [expiredUserIds]
  )

  // Reset custom_text, expires_at, and revert DND status on user_status
  await pool.query(
    `UPDATE aaelink.user_status
     SET custom_text = '',
         expires_at = 0,
         status = CASE WHEN status = 'dnd' THEN 'online' ELSE status END,
         updated_at = $1
     WHERE user_id = ANY($2::uuid[]) AND expires_at > 0 AND expires_at <= $1`,
    [now, expiredUserIds]
  )

  return NextResponse.json({ cleared: expiredUserIds.length })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/user-status/expire', _POST)
