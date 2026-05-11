import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/search/advanced?q=...&workspace_id=...&limit=...&offset=...
 *
 * Slack-style search operators:
 *   from:username      — filter by author
 *   in:#channel-name   — filter by channel name
 *   has:link           — messages containing http(s) URLs
 *   has:reaction       — messages that have at least one reaction
 *   has:pin            — messages that are pinned
 *   before:YYYY-MM-DD  — messages before date
 *   after:YYYY-MM-DD   — messages after date
 *   is:thread          — only thread replies (root_id != '')
 *
 * Remaining text after operators is the keyword search.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('q')?.trim() || ''
  if (!raw) return NextResponse.json({ results: [], total: 0, filters: {} })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id') || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 25, 50)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)

  // ── Parse search operators ──────────────────────────────────────────
  const filters: {
    from?: string
    in?: string
    hasLink?: boolean
    hasReaction?: boolean
    hasPin?: boolean
    before?: string
    after?: string
    isThread?: boolean
  } = {}

  let keywords = raw
  // from:username
  keywords = keywords.replace(/from:(\S+)/gi, (_, u) => { filters.from = u; return '' })
  // in:#channel or in:channel
  keywords = keywords.replace(/in:#?(\S+)/gi, (_, c) => { filters.in = c; return '' })
  // has:link / has:reaction / has:pin
  keywords = keywords.replace(/has:(link|reaction|pin)/gi, (_, t) => {
    const key = t.toLowerCase()
    if (key === 'link') filters.hasLink = true
    else if (key === 'reaction') filters.hasReaction = true
    else if (key === 'pin') filters.hasPin = true
    return ''
  })
  // before:YYYY-MM-DD
  keywords = keywords.replace(/before:(\d{4}-\d{2}-\d{2})/gi, (_, d) => { filters.before = d; return '' })
  // after:YYYY-MM-DD
  keywords = keywords.replace(/after:(\d{4}-\d{2}-\d{2})/gi, (_, d) => { filters.after = d; return '' })
  // is:thread
  keywords = keywords.replace(/is:thread/gi, () => { filters.isThread = true; return '' })

  keywords = keywords.replace(/\s+/g, ' ').trim()

  // ── Build SQL ───────────────────────────────────────────────────────
  const params: (string | number)[] = [uid, workspaceId]
  let paramIdx = 3
  const conditions: string[] = [
    `c.workspace_id = $2`,
    `c.archived_at = 0`,
    `(c.type IN ('O','P') OR (c.type = 'D' AND (c.dm_user_a = $1 OR c.dm_user_b = $1)))`,
    // For private channels, user must be a member
    `(c.type <> 'P' OR EXISTS (SELECT 1 FROM aaelink.channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1))`
  ]

  if (keywords) {
    const escaped = keywords.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    conditions.push(`m.body ILIKE $${paramIdx} ESCAPE '\\'`)
    params.push(`%${escaped}%`)
    paramIdx++
  }

  if (filters.from) {
    conditions.push(`u.username = $${paramIdx}`)
    params.push(filters.from)
    paramIdx++
  }

  if (filters.in) {
    conditions.push(`c.name = $${paramIdx}`)
    params.push(filters.in.toLowerCase())
    paramIdx++
  }

  if (filters.hasLink) {
    conditions.push(`(m.body LIKE '%http://%' OR m.body LIKE '%https://%')`)
  }

  if (filters.hasReaction) {
    conditions.push(`EXISTS (SELECT 1 FROM aaelink.message_reactions r WHERE r.message_id = m.id)`)
  }

  if (filters.hasPin) {
    conditions.push(`EXISTS (SELECT 1 FROM aaelink.pinned_messages pm WHERE pm.message_id = m.id)`)
  }

  if (filters.before) {
    const ts = new Date(filters.before).getTime()
    if (!isNaN(ts)) {
      conditions.push(`m.created_at < $${paramIdx}`)
      params.push(ts)
      paramIdx++
    }
  }

  if (filters.after) {
    const ts = new Date(filters.after).getTime()
    if (!isNaN(ts)) {
      conditions.push(`m.created_at > $${paramIdx}`)
      params.push(ts)
      paramIdx++
    }
  }

  if (filters.isThread) {
    conditions.push(`m.root_id <> ''`)
  }

  const whereClause = conditions.join(' AND ')

  const sql = `
    SELECT
      m.id AS message_id,
      m.body,
      m.created_at,
      m.channel_id,
      m.root_id,
      c.name AS channel_name,
      c.display_name AS channel_display,
      c.type AS channel_type,
      u.id AS author_id,
      u.username AS author_username,
      u.first_name AS author_first_name,
      u.last_name AS author_last_name,
      u.avatar_url AS author_avatar_url
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    JOIN aaelink.users u ON u.id = m.user_id
    WHERE ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `
  params.push(limit, offset)

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    JOIN aaelink.users u ON u.id = m.user_id
    WHERE ${whereClause}
  `
  const countParams = params.slice(0, paramIdx - 1)

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(sql, params),
    pool.query<{ total: number }>(countSql, countParams)
  ])

  return NextResponse.json({
    query: raw,
    keywords,
    filters,
    results: rows.map((r: Record<string, unknown>) => ({
      message_id: r.message_id,
      body: String(r.body || ''),
      snippet: String(r.body || '').length > 200
        ? `${String(r.body || '').slice(0, 197)}...`
        : String(r.body || ''),
      created_at: Number(r.created_at),
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_display: r.channel_display,
      channel_type: r.channel_type,
      root_id: r.root_id || null,
      author_id: r.author_id,
      author_username: r.author_username,
      author_display_name: [r.author_first_name, r.author_last_name].filter(Boolean).join(' ') || r.author_username,
      author_avatar_url: r.author_avatar_url
    })),
    total: countRows[0]?.total ?? 0,
    limit,
    offset
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/advanced', _GET)
