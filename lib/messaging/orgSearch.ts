/**
 * D4 Search — cross-workspace lexical search across the organization.
 *
 * Slack Grid lets a user search every workspace in their org, not just the one
 * they are viewing. This searches messages in the channels a user can legitimately
 * reach across all workspaces of the org(s) they belong to (depends on D1):
 *
 *   - channels they are a member of (any workspace), OR
 *   - public channels in any workspace of their org(s), OR
 *   - org-wide channels in their org(s), OR
 *   - DMs they participate in.
 *
 * This is lexical (ILIKE), non-AI. It also tightens visibility versus the
 * single-workspace search, which matched every public channel globally
 * regardless of org — here public matches are confined to the caller's orgs.
 */
import type { Pool } from 'pg'

export interface OrgSearchResult {
  message_id: string
  body: string
  created_at: number
  channel_id: string
  channel_name: string
  channel_type: string
  workspace_id: string
  org_id: string | null
  author_id: string
  author_username: string
}

export interface OrgSearchResponse {
  results: OrgSearchResult[]
  total: number
  limit: number
  offset: number
}

/**
 * Search messages across all workspaces in the user's org(s). `q` must be at
 * least 2 characters; shorter queries return empty. Results are newest-first and
 * paginated.
 */
export async function searchOrgMessages(
  pool: Pool,
  uid: string,
  q: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<OrgSearchResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50)
  const offset = Math.max(opts.offset ?? 0, 0)
  const query = (q || '').trim()
  if (query.length < 2) return { results: [], total: 0, limit, offset }

  const pattern = `%${query}%`

  // The visibility predicate: reachable channels across the caller's org graph.
  // $1 = uid, $2 = pattern.
  const visibility = `
    m.body ILIKE $2
    AND c.archived_at = 0
    AND (
      EXISTS (
        SELECT 1 FROM aaelink.channel_members cm
        WHERE cm.channel_id = c.id AND cm.user_id = $1
      )
      OR (c.type = 'D' AND (c.dm_user_a = $1 OR c.dm_user_b = $1))
      OR (
        c.type = 'O'
        AND c.workspace_id IN (
          SELECT w.id FROM aaelink.workspaces w
          WHERE w.org_id IN (
            SELECT DISTINCT w2.org_id
            FROM aaelink.workspaces w2
            JOIN aaelink.workspace_members m2 ON m2.workspace_id = w2.id AND m2.user_id = $1
            WHERE w2.org_id IS NOT NULL
          )
        )
      )
      OR (
        c.is_org_wide = true
        AND c.org_id IN (
          SELECT DISTINCT w3.org_id
          FROM aaelink.workspaces w3
          JOIN aaelink.workspace_members m3 ON m3.workspace_id = w3.id AND m3.user_id = $1
          WHERE w3.org_id IS NOT NULL
        )
      )
    )
  `

  const sql = `
    SELECT m.id AS message_id, m.body, m.created_at, m.channel_id,
           c.display_name AS channel_name, c.type AS channel_type,
           c.workspace_id, c.org_id::text AS org_id,
           u.id AS author_id, u.username AS author_username
      FROM aaelink.messages m
      JOIN aaelink.channels c ON c.id = m.channel_id
      JOIN aaelink.users u ON u.id = m.user_id
     WHERE ${visibility}
     ORDER BY m.created_at DESC
     LIMIT $3 OFFSET $4
  `
  const countSql = `
    SELECT COUNT(*)::int AS total
      FROM aaelink.messages m
      JOIN aaelink.channels c ON c.id = m.channel_id
     WHERE ${visibility}
  `

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<{
      message_id: string; body: string; created_at: string; channel_id: string
      channel_name: string; channel_type: string; workspace_id: string; org_id: string | null
      author_id: string; author_username: string
    }>(sql, [uid, pattern, limit, offset]),
    pool.query<{ total: number }>(countSql, [uid, pattern]),
  ])

  return {
    results: rows.map(r => ({ ...r, created_at: Number(r.created_at) })),
    total: countRows[0]?.total ?? 0,
    limit,
    offset,
  }
}
