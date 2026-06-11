/**
 * searchChannels — server-side channel discovery helper.
 *
 * Returns discoverable channels for the calling user:
 *   - Public (type='O') channels whose workspace_id the caller is a member of, OR
 *   - Org-wide (is_org_wide=true) channels in any workspace in the same org.
 * Archived channels (archived_at > 0 OR is_archived = true) are always excluded.
 *
 * Matches `q` against name / display_name / purpose / description with ILIKE.
 * Exact-prefix matches are ranked first; ties go alphabetical.
 *
 * Empty `q` = browse-all (alphabetical).
 *
 * Returns { channels, total } where total is the unsliced count for pagination.
 */

import type { Pool } from 'pg'

export interface SearchChannelsParams {
  q?: string
  workspaceId: string
  limit?: number
  offset?: number
}

export interface ChannelSearchResult {
  id: string
  team_id: string
  name: string
  display_name: string
  type: string
  purpose: string
  description: string
  member_count: number
  joined: boolean
  is_org_wide: boolean
}

export interface SearchChannelsResult {
  channels: ChannelSearchResult[]
  total: number
}

export async function searchChannels(
  pool: Pool,
  uid: string,
  params: SearchChannelsParams
): Promise<SearchChannelsResult> {
  const { workspaceId, limit = 25, offset = 0 } = params
  const q = (params.q ?? '').trim()

  // Visibility: public channels in the caller's workspace, or org-wide channels
  // in the same org. Archived channels always excluded.
  // Uses positional params: $1 = workspaceId (text).
  // uid is passed as a separate subquery param to avoid type-inference issues.
  const visibilityClause = `
    (
      (c.type = 'O' AND c.workspace_id = $1::text)
      OR (
        c.is_org_wide = true
        AND c.org_id IS NOT NULL
        AND c.org_id = (SELECT org_id FROM aaelink.workspaces WHERE id = $1::text)
      )
    )
    AND c.archived_at = 0
    AND NOT COALESCE(c.is_archived, false)
  `

  if (!q) {
    // Count: only needs workspaceId
    const { rows: countRows } = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM aaelink.channels c WHERE ${visibilityClause}`,
      [workspaceId]
    )
    const total = countRows[0]?.total ?? 0

    // Data: needs workspaceId ($1) + uid ($2) + limit ($3) + offset ($4)
    const { rows } = await pool.query<RowShape>(
      `SELECT
        c.id,
        c.workspace_id AS team_id,
        c.name,
        c.display_name,
        c.type,
        c.purpose,
        COALESCE(c.description, '') AS description,
        COALESCE(c.is_org_wide, false) AS is_org_wide,
        COUNT(cm_all.user_id)::int AS member_count,
        (EXISTS (
          SELECT 1 FROM aaelink.channel_members cm_me
          WHERE cm_me.channel_id = c.id AND cm_me.user_id = $2::text
        )) AS joined
      FROM aaelink.channels c
      LEFT JOIN aaelink.channel_members cm_all ON cm_all.channel_id = c.id
      WHERE ${visibilityClause}
      GROUP BY c.id
      ORDER BY c.display_name ASC, c.name ASC
      LIMIT $3 OFFSET $4`,
      [workspaceId, uid, limit, offset]
    )

    return { channels: rows.map(normaliseRow), total }
  }

  // Text search — rank exact-prefix matches first, then alphabetical
  const containsPattern = `%${q}%`
  const prefixPattern = `${q}%`

  // Count: workspaceId ($1) + containsPattern ($2)
  const { rows: countRows } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM aaelink.channels c
     WHERE ${visibilityClause}
       AND (
         c.name             ILIKE $2
         OR c.display_name  ILIKE $2
         OR c.purpose       ILIKE $2
         OR COALESCE(c.description, '') ILIKE $2
       )`,
    [workspaceId, containsPattern]
  )
  const total = countRows[0]?.total ?? 0

  // Data: workspaceId ($1) + uid ($2) + containsPattern ($3) + prefixPattern ($4) + limit ($5) + offset ($6)
  const { rows } = await pool.query<RowShape & { rank_score: number }>(
    `SELECT
      c.id,
      c.workspace_id AS team_id,
      c.name,
      c.display_name,
      c.type,
      c.purpose,
      COALESCE(c.description, '') AS description,
      COALESCE(c.is_org_wide, false) AS is_org_wide,
      COUNT(cm_all.user_id)::int AS member_count,
      (EXISTS (
        SELECT 1 FROM aaelink.channel_members cm_me
        WHERE cm_me.channel_id = c.id AND cm_me.user_id = $2::text
      )) AS joined,
      CASE
        WHEN c.display_name ILIKE $4 THEN 0
        WHEN c.name         ILIKE $4 THEN 1
        ELSE 2
      END AS rank_score
    FROM aaelink.channels c
    LEFT JOIN aaelink.channel_members cm_all ON cm_all.channel_id = c.id
    WHERE ${visibilityClause}
      AND (
        c.name             ILIKE $3
        OR c.display_name  ILIKE $3
        OR c.purpose       ILIKE $3
        OR COALESCE(c.description, '') ILIKE $3
      )
    GROUP BY c.id
    ORDER BY rank_score ASC, c.display_name ASC, c.name ASC
    LIMIT $5 OFFSET $6`,
    [workspaceId, uid, containsPattern, prefixPattern, limit, offset]
  )

  return { channels: rows.map(normaliseRow), total }
}

interface RowShape {
  id: string
  team_id: string
  name: string
  display_name: string
  type: string
  purpose: string
  description: string
  is_org_wide: boolean
  member_count: number
  joined: boolean
}

function normaliseRow(r: RowShape): ChannelSearchResult {
  return {
    id: r.id,
    team_id: r.team_id,
    name: r.name,
    display_name: r.display_name,
    type: r.type,
    purpose: r.purpose ?? '',
    description: r.description ?? '',
    member_count: Number(r.member_count) || 0,
    joined: Boolean(r.joined),
    is_org_wide: Boolean(r.is_org_wide),
  }
}
