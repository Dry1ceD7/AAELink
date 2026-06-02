import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/admin/stats — platform dashboard metrics.
 *
 * Returns:
 *  - user_count, active_today, active_7d
 *  - channel_count (public + private)
 *  - message_count, messages_today
 *  - workspace_count
 *  - session_count (active)
 *  - storage_bytes (estimated from documents)
 */
async function _GET() {
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

  const now = Date.now()
  const dayAgo = now - 24 * 60 * 60 * 1000
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000

  // Batch all counts in parallel
  const [
    userCount,
    activeToday,
    active7d,
    channelCount,
    messageCount,
    messagesToday,
    workspaceCount,
    sessionCount,
    storageBytes
  ] = await Promise.all([
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.users`),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.users WHERE last_seen_at >= $1`, [dayAgo]),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.users WHERE last_seen_at >= $1`, [weekAgo]),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.channels WHERE type IN ('O','P')`),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.messages`),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.messages WHERE created_at >= $1`, [dayAgo]),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.workspaces`),
    pool.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM aaelink.sessions WHERE expires_at > $1`, [now]),
    pool.query<{ total: string }>(`SELECT COALESCE(SUM(size_bytes), 0)::text AS total FROM aaelink.documents`).catch(() => ({ rows: [{ total: '0' }] }))
  ])

  return NextResponse.json({
    stats: {
      user_count: Number(userCount.rows[0]?.cnt || 0),
      active_today: Number(activeToday.rows[0]?.cnt || 0),
      active_7d: Number(active7d.rows[0]?.cnt || 0),
      channel_count: Number(channelCount.rows[0]?.cnt || 0),
      message_count: Number(messageCount.rows[0]?.cnt || 0),
      messages_today: Number(messagesToday.rows[0]?.cnt || 0),
      workspace_count: Number(workspaceCount.rows[0]?.cnt || 0),
      session_count: Number(sessionCount.rows[0]?.cnt || 0),
      storage_bytes: Number(storageBytes.rows[0]?.total || 0),
      generated_at: now
    }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/stats', _GET)
