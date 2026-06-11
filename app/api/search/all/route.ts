import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { searchMessages } from '@/lib/messaging/searchEngine'
import { filterSearchBlocked } from '@/lib/enterprise/barrierGuard'

/**
 * GET /api/search/all?q=&workspace_id=&limit=
 *
 * Combined Slack search.all parity — messages + files + people in one call.
 * Fans out three concurrent queries and returns a unified response whose facet
 * item shapes are IDENTICAL to the standalone /search/messages, /search/files
 * and /search/users routes so clients can reuse existing renderers.
 *
 * Per-facet limit: default 8, max 25 (pass `limit=N`).
 *
 * Response:
 *   { messages: SearchEngineHit[], files: FileHit[], people: UserHit[],
 *     counts: { messages: number, files: number, people: number } }
 */

const PER_FACET_DEFAULT = 8
const PER_FACET_MAX = 25

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim() || ''
  if (!q || q.length < 2) {
    return NextResponse.json({
      messages: [], files: [], people: [],
      counts: { messages: 0, files: 0, people: 0 },
    })
  }

  const workspaceId = sp.get('workspace_id')?.trim() || ''
  const rawLimit = Number(sp.get('limit'))
  const facetLimit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : PER_FACET_DEFAULT, 1),
    PER_FACET_MAX
  )

  // ── Workspace membership check ─────────────────────────────────────
  // When workspace_id is supplied, assert the caller is a member before
  // scoping any results to it.
  if (workspaceId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [workspaceId, uid]
    )
    if (!rows.length) {
      return NextResponse.json({ error: 'workspace_not_found' }, { status: 403 })
    }
  }

  // ── File FTS helper (mirrors search/files GET logic exactly) ───────
  const tsQuery = q.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).join(' & ')

  const filesQuery = tsQuery
    ? pool.query<Record<string, unknown>>(`
        SELECT fi.id, fi.file_id, fi.filename, fi.file_type, fi.channel_id,
               fi.uploaded_by, u.username AS uploaded_by_username,
               fi.indexed_at, fi.content_length,
               ts_rank(fi.search_vector, to_tsquery($1)) AS relevance,
               ts_headline('english', fi.content_preview, to_tsquery($1),
                           'StartSel=<mark>, StopSel=</mark>, MaxFragments=3, MaxWords=30'
               ) AS highlights
        FROM aaelink.file_index fi
        LEFT JOIN aaelink.users u ON u.id = fi.uploaded_by
        WHERE fi.search_vector @@ to_tsquery($1)
        ORDER BY relevance DESC
        LIMIT $2
      `, [tsQuery, facetLimit])
    : Promise.resolve({ rows: [] as Record<string, unknown>[] })

  // ── People query (mirrors search/users GET logic exactly) ──────────
  const pattern = `%${q}%`
  let usersQuery: Promise<{ rows: Record<string, unknown>[] }>
  if (workspaceId) {
    usersQuery = pool.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.email,
             u.avatar_url, u.job_title, u.phone, u.timezone,
             u.status_text, u.status_emoji, u.department,
             u.platform_role, u.pronouns,
             us.status AS presence_status
      FROM aaelink.users u
      JOIN aaelink.workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = $2
      LEFT JOIN aaelink.user_status us ON us.user_id = u.id
      WHERE (u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
             OR u.email ILIKE $1 OR u.department ILIKE $1 OR u.job_title ILIKE $1)
      ORDER BY
        CASE WHEN u.username ILIKE $1 THEN 0 ELSE 1 END,
        u.username ASC
      LIMIT $3
    `, [pattern, workspaceId, facetLimit])
  } else {
    usersQuery = pool.query(`
      SELECT u.id, u.username, u.first_name, u.last_name, u.email,
             u.avatar_url, u.job_title, u.phone, u.timezone,
             u.status_text, u.status_emoji, u.department,
             u.platform_role, u.pronouns,
             us.status AS presence_status
      FROM aaelink.users u
      LEFT JOIN aaelink.user_status us ON us.user_id = u.id
      WHERE (u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
             OR u.email ILIKE $1 OR u.department ILIKE $1 OR u.job_title ILIKE $1)
      ORDER BY
        CASE WHEN u.username ILIKE $1 THEN 0 ELSE 1 END,
        u.username ASC
      LIMIT $2
    `, [pattern, facetLimit])
  }

  // ── Messages (reuses shared FTS engine with channel ACL) ───────────
  const messagesQuery = searchMessages(pool, {
    uid,
    q,
    workspaceId,
    sort: 'relevance',
    limit: facetLimit,
    offset: 0,
  })

  // ── Fan out all three concurrently ─────────────────────────────────
  const [messagesResult, filesResult, usersResult] = await Promise.all([
    messagesQuery,
    filesQuery,
    usersQuery,
  ])

  const files = filesResult.rows.map(r => ({ ...r, indexed_at: Number(r.indexed_at) }))

  // ── Barrier filtering for people facet ────────────────────────────
  // Apply the same information-barrier search filter as /api/search/users
  // so that users blocked by an active barrier (block_search=true) are
  // never surfaced through the combined endpoint.
  const rawPeople = usersResult.rows
  const blocked = await filterSearchBlocked(pool, uid, rawPeople.map((r: Record<string, unknown>) => r.id as string))
  const people = rawPeople.filter((r: Record<string, unknown>) => !blocked.has(r.id as string))

  // counts reflect the number of items RETURNED in each facet (post-filter,
  // post-limit) so the client can render "N results" accurately without
  // inspecting the arrays themselves.
  return NextResponse.json({
    messages: messagesResult.results,
    files,
    people,
    counts: {
      messages: messagesResult.results.length,
      files: files.length,
      people: people.length,
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/search/all', _GET)
