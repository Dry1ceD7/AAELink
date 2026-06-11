/**
 * D4 Search — cross-workspace search across the organization.
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
 * The org-graph reachability and the lexical match both live in the shared
 * Postgres-FTS engine (lib/messaging/searchEngine.ts, scope='org'). Text matching
 * is real FTS on body_tsv (was ILIKE substring); when sort='relevance' results
 * rank by ts_rank, otherwise newest-first. Org isolation is unchanged: public
 * matches stay confined to the caller's orgs.
 */
import type { Pool } from 'pg'
import { searchMessages, type SearchSort } from '@/lib/messaging/searchEngine'

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
 * least 2 characters; shorter queries return empty. Paginated; defaults to
 * newest-first (sort='recent'), or ts_rank order when sort='relevance'.
 */
export async function searchOrgMessages(
  pool: Pool,
  uid: string,
  q: string,
  opts: { limit?: number; offset?: number; sort?: SearchSort } = {}
): Promise<OrgSearchResponse> {
  const { results, total, limit, offset } = await searchMessages(pool, {
    uid,
    q,
    scope: 'org',
    sort: opts.sort === 'relevance' ? 'relevance' : 'recent',
    limit: opts.limit,
    offset: opts.offset,
  })

  return {
    results: results.map(r => ({
      message_id: r.message_id,
      body: r.body,
      created_at: r.created_at,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_type: r.channel_type,
      workspace_id: r.workspace_id,
      org_id: r.org_id,
      author_id: r.author_id,
      author_username: r.author_username,
    })),
    total,
    limit,
    offset,
  }
}
