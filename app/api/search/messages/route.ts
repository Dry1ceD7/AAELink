import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/search/messages?q=...&workspace_id=...&channel_id=...&limit=...&offset=...
 * Full-text search across messages the user has access to.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  if (!q || q.length < 2) return NextResponse.json({ results: [], total: 0 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id') || ''
  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 25, 50)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)

  const fromUser = req.nextUrl.searchParams.get('from') || ''
  const before   = req.nextUrl.searchParams.get('before') || ''
  const after    = req.nextUrl.searchParams.get('after') || ''
  const has      = req.nextUrl.searchParams.get('has') || ''

  const pattern = `%${q}%`
  const params: (string | number)[] = [uid, pattern]
  let idx = 3

  // Build WHERE clauses
  let channelFilter = ''
  if (channelId) {
    channelFilter = ` AND m.channel_id = $${idx}`
    params.push(channelId)
    idx++
  } else if (workspaceId) {
    channelFilter = ` AND c.workspace_id = $${idx}`
    params.push(workspaceId)
    idx++
  }

  // from:<username> — filter by author
  let fromFilter = ''
  if (fromUser) {
    fromFilter = ` AND u.username = $${idx}`
    params.push(fromUser)
    idx++
  }

  // before:<YYYY-MM-DD> — messages before date
  let beforeFilter = ''
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    const ts = new Date(`${before}T23:59:59`).getTime()
    beforeFilter = ` AND m.created_at <= $${idx}`
    params.push(ts)
    idx++
  }

  // after:<YYYY-MM-DD> — messages after date
  let afterFilter = ''
  if (after && /^\d{4}-\d{2}-\d{2}$/.test(after)) {
    const ts = new Date(`${after}T00:00:00`).getTime()
    afterFilter = ` AND m.created_at >= $${idx}`
    params.push(ts)
    idx++
  }

  // has:<type> — filter by content type
  let hasFilter = ''
  if (has === 'file' || has === 'attachment') {
    hasFilter = ` AND EXISTS (SELECT 1 FROM aaelink.file_attachments fa WHERE fa.message_id = m.id)`
  } else if (has === 'pin') {
    hasFilter = ` AND EXISTS (SELECT 1 FROM aaelink.pinned_messages pm WHERE pm.message_id = m.id)`
  } else if (has === 'reaction') {
    hasFilter = ` AND EXISTS (SELECT 1 FROM aaelink.reactions r2 WHERE r2.message_id = m.id)`
  } else if (has === 'link') {
    hasFilter = ` AND m.body ~ 'https?://'`
  }

  const extraFilters = `${channelFilter}${fromFilter}${beforeFilter}${afterFilter}${hasFilter}`

  // Search query — join messages with channels and users,
  // filtering to channels the user has access to (public or member)
  const sql = `
    SELECT
      m.id AS message_id,
      m.body,
      m.created_at,
      m.channel_id,
      c.display_name AS channel_name,
      c.type AS channel_type,
      c.workspace_id,
      u.id AS author_id,
      u.username AS author_username,
      u.first_name AS author_first_name,
      u.last_name AS author_last_name
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    JOIN aaelink.users u ON u.id = m.user_id
    WHERE m.body ILIKE $2
      AND c.archived_at = 0
      AND (
        c.type = 'O'
        OR EXISTS (
          SELECT 1 FROM aaelink.channel_members cm
          WHERE cm.channel_id = c.id AND cm.user_id = $1
        )
        OR (c.type = 'D' AND (c.dm_user_a = $1 OR c.dm_user_b = $1))
      )
      ${extraFilters}
    ORDER BY m.created_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `
  params.push(limit, offset)

  // Count query for pagination
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    JOIN aaelink.users u ON u.id = m.user_id
    WHERE m.body ILIKE $2
      AND c.archived_at = 0
      AND (
        c.type = 'O'
        OR EXISTS (
          SELECT 1 FROM aaelink.channel_members cm
          WHERE cm.channel_id = c.id AND cm.user_id = $1
        )
        OR (c.type = 'D' AND (c.dm_user_a = $1 OR c.dm_user_b = $1))
      )
      ${extraFilters}
  `
  const countParams = params.slice(0, idx - 1) // all params except limit/offset

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(sql, params),
    pool.query<{ total: number }>(countSql, countParams)
  ])

  return NextResponse.json({
    results: rows,
    total: countRows[0]?.total ?? 0,
    limit,
    offset
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/messages', _GET)
