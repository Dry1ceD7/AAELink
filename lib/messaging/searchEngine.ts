/**
 * AAELink — unified message search engine (Postgres FTS).
 *
 * One engine behind every message-search surface (`search/messages`,
 * `messages/search`, `search/advanced`, `search/org-messages`). It runs a
 * single lexical query against the `body_tsv` GENERATED tsvector column
 * (migration 023) using `websearch_to_tsquery('english', q)`, ranks with
 * `ts_rank`, and returns a server-side `ts_headline` highlight per hit.
 *
 * ACL stays IN the query: results are scoped to channels the caller can read
 * (public channel in scope, member of a private/public channel, or a DM they
 * participate in). Channel-name resolution only matches channels the caller can
 * read — an unreadable name behaves as a no-match so private channel existence
 * never leaks.
 *
 * Two visibility scopes:
 *   - 'workspace' (default): the single-workspace / global behaviour the
 *     `search/messages` route shipped — public channels, member channels, DMs.
 *   - 'org': the D4 cross-workspace org-graph reachability from
 *     `lib/messaging/orgSearch.ts` (member channels anywhere, public channels in
 *     the caller's org(s), org-wide channels in the caller's org(s), DMs).
 *
 * AI/ML semantic search is out of scope; this is lexical PG FTS only.
 *
 * Date operators (before:/after:/on:/during:) — TIME ZONE CONTRACT:
 *   All calendar-day operators are interpreted in **UTC**, NOT server-local time.
 *   `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `on:YYYY-MM-DD`, and `during:YYYY[-MM]`
 *   are converted to epoch-ms window bounds via `new Date('<ymd>T00:00:00.000Z')` /
 *   `Date.UTC(...)` — the trailing `Z` / `Date.UTC` pins the boundary to UTC
 *   midnight, so the result is independent of the server's TZ env. `created_at` is
 *   compared as epoch-ms, so the windows are exact regardless of where the process
 *   runs. Concretely: `on:2025-03-04` matches `[2025-03-04T00:00:00Z, 2025-03-05T00:00:00Z)`.
 *   This is deliberate (deterministic across deploys); a user in UTC+7 asking for
 *   `on:2025-03-04` gets the UTC day, not their local day. Pinned by
 *   tests/searchDateWindows.test.ts.
 */
import type { Pool } from 'pg'

export type SearchHasFilter = 'file' | 'attachment' | 'pin' | 'reaction' | 'link'
export type SearchSort = 'relevance' | 'recent' | 'oldest'
export type SearchScope = 'workspace' | 'org'

export interface SearchEngineFilters {
  /** Match exact author username. */
  fromUser?: string
  /** Restrict to a single channel by opaque id. */
  channelId?: string
  /** Restrict to a single channel by human name — resolved to readable channels only. */
  channelName?: string
  /** before:YYYY-MM-DD — strictly-before end-of-day (inclusive of the day). UTC day (see module TIME ZONE CONTRACT). */
  before?: string
  /** after:YYYY-MM-DD — at/after start-of-day. UTC day (see module TIME ZONE CONTRACT). */
  after?: string
  /**
   * Epoch-ms exclusive lower bound on created_at (created_at > afterMs). Unlike
   * `after` (calendar-day granularity) this is millisecond-precise, used for
   * watermark paging (e.g. saved-search alerts draining a backlog). Combines
   * with `after`/date windows via AND.
   */
  afterMs?: number
  /** on:YYYY-MM-DD — the whole calendar day. */
  on?: string
  /** during:YYYY | during:YYYY-MM — the whole year or month. */
  during?: string
  /** has: content-type filters (any-of). */
  has?: SearchHasFilter[]
  /** is:thread — only thread replies (root_id <> ''). */
  isThread?: boolean
  /** is:pinned — only pinned messages. */
  isPinned?: boolean
  /** is:saved — only messages the caller has saved. */
  isSaved?: boolean
}

export interface SearchEngineInput {
  uid: string
  q: string
  filters?: SearchEngineFilters
  /** Restrict to one workspace (scope='workspace' only). */
  workspaceId?: string
  scope?: SearchScope
  sort?: SearchSort
  limit?: number
  offset?: number
}

export interface SearchEngineHit {
  message_id: string
  body: string
  /** Server-side ts_headline highlight (StartSel=<mark>). Falls back to a body prefix when no q. */
  highlight: string
  created_at: number
  channel_id: string
  channel_name: string
  channel_type: string
  workspace_id: string
  org_id: string | null
  root_id: string | null
  author_id: string
  author_username: string
  author_first_name: string
  author_last_name: string
  author_avatar_url: string | null
  rank: number
}

export interface SearchEngineResult {
  results: SearchEngineHit[]
  total: number
  limit: number
  offset: number
}

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 25
/** ts_headline fragment cap. */
const HEADLINE_OPTS = 'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=24, MinWords=8, ShortWord=2'

/** YYYY-MM-DD */
export function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * Day window [start, endExclusive) in epoch ms for a YYYY-MM-DD. Returns null if
 * invalid. The boundary is **UTC midnight** (the trailing `Z`), NOT server-local —
 * see the module-level TIME ZONE CONTRACT. This makes the window deterministic
 * regardless of the process TZ.
 */
export function dayWindow(ymd: string): { start: number; end: number } | null {
  if (!isYmd(ymd)) return null
  const start = new Date(`${ymd}T00:00:00.000Z`).getTime()
  if (Number.isNaN(start)) return null
  return { start, end: start + 86_400_000 }
}

/**
 * Month/year window [start, endExclusive) in epoch ms for during:YYYY or during:YYYY-MM.
 * Returns null if malformed.
 */
export function duringWindow(spec: string): { start: number; end: number } | null {
  if (/^\d{4}$/.test(spec)) {
    const y = Number(spec)
    const start = Date.UTC(y, 0, 1)
    const end = Date.UTC(y + 1, 0, 1)
    return { start, end }
  }
  if (/^\d{4}-\d{2}$/.test(spec)) {
    const [ys, ms] = spec.split('-')
    const y = Number(ys)
    const m = Number(ms) // 1-12
    if (m < 1 || m > 12) return null
    const start = Date.UTC(y, m - 1, 1)
    const end = Date.UTC(y, m, 1) // JS Date rolls over Dec→next Jan
    return { start, end }
  }
  return null
}

/**
 * The channel-visibility predicate (ACL). `$1` is always the caller uid. For
 * scope='workspace' an optional workspace filter is folded in by the caller. For
 * scope='org' this reproduces the org-graph reachability of orgSearch.ts.
 */
function visibilityClause(scope: SearchScope): string {
  if (scope === 'org') {
    return `
      c.archived_at = 0
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
  }
  // workspace (default): public channels, member channels, DMs.
  return `
    c.archived_at = 0
    AND (
      c.type = 'O'
      OR EXISTS (
        SELECT 1 FROM aaelink.channel_members cm
        WHERE cm.channel_id = c.id AND cm.user_id = $1
      )
      OR (c.type = 'D' AND (c.dm_user_a = $1 OR c.dm_user_b = $1))
    )
  `
}

/**
 * Run a full-text message search.
 *
 * `$1` = uid, `$2` = raw q. Both query builders share the same parameter list so
 * the count query reuses the prefix. The caller-visible channel set (ACL) is
 * always enforced; the only thing the caller controls is the extra filter set.
 */
export async function searchMessages(
  pool: Pool,
  input: SearchEngineInput
): Promise<SearchEngineResult> {
  const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(input.offset) || 0, 0)
  const q = (input.q || '').trim()
  const scope: SearchScope = input.scope === 'org' ? 'org' : 'workspace'
  const sort: SearchSort = input.sort === 'recent' || input.sort === 'oldest'
    ? input.sort
    : 'relevance'
  const f = input.filters || {}

  // Is at least one structured filter present? A filters-only query (e.g.
  // `from:alice in:general`, `has:file`, `is:pinned` with no free-text) is a
  // first-class advanced-search case — it must NOT short-circuit to empty.
  const hasAnyFilter = Boolean(
    f.channelId || f.channelName || f.fromUser || f.on || f.during || f.before || f.after ||
    (typeof f.afterMs === 'number' && Number.isFinite(f.afterMs)) ||
    (Array.isArray(f.has) && f.has.length > 0) ||
    f.isThread || f.isPinned || f.isSaved
  )
  // FTS text path requires >= 2 chars (websearch_to_tsquery on a 1-char token is
  // useless). Filters-only mode bypasses the @@ predicate entirely.
  const useFts = q.length >= 2

  // Nothing to search on at all (no usable text AND no filters) → empty.
  if (!useFts && !hasAnyFilter) return { results: [], total: 0, limit, offset }

  // $1 = uid. In FTS mode $2 = q (referenced by @@ / ts_rank / ts_headline). In
  // filters-only mode q is NOT bound — an unreferenced parameter makes Postgres
  // raise "could not determine data type of parameter $2" — so we omit it and
  // start appended filter params at $2. The FTS SQL only ever references $2 when
  // useFts is true, so this stays consistent.
  const params: (string | number)[] = useFts ? [input.uid, q] : [input.uid]
  let idx = useFts ? 3 : 2
  const extra: string[] = []

  // Workspace narrowing (workspace scope only; org scope spans workspaces).
  if (scope === 'workspace') {
    if (f.channelId) {
      extra.push(`m.channel_id = $${idx}`)
      params.push(f.channelId)
      idx++
    } else if (input.workspaceId) {
      extra.push(`c.workspace_id = $${idx}`)
      params.push(input.workspaceId)
      idx++
    }
  } else if (f.channelId) {
    extra.push(`m.channel_id = $${idx}`)
    params.push(f.channelId)
    idx++
  }

  // in:<name> — resolve only against channels the caller can read. We add the
  // name predicate on c.name; the ACL visibility clause already restricts c to
  // readable channels, so an unreadable name simply matches no rows (no leak).
  if (f.channelName) {
    extra.push(`c.name = $${idx}`)
    params.push(f.channelName.toLowerCase())
    idx++
  }

  // from:<username>
  if (f.fromUser) {
    extra.push(`u.username = $${idx}`)
    params.push(f.fromUser)
    idx++
  }

  // Date windows. on: and during: are whole-period; before:/after: are open-ended.
  if (f.on) {
    const w = dayWindow(f.on)
    if (w) {
      extra.push(`m.created_at >= $${idx} AND m.created_at < $${idx + 1}`)
      params.push(w.start, w.end)
      idx += 2
    }
  }
  if (f.during) {
    const w = duringWindow(f.during)
    if (w) {
      extra.push(`m.created_at >= $${idx} AND m.created_at < $${idx + 1}`)
      params.push(w.start, w.end)
      idx += 2
    }
  }
  if (f.before && isYmd(f.before)) {
    const w = dayWindow(f.before)
    if (w) {
      // inclusive of the day itself (end-of-day) — matches the legacy route.
      extra.push(`m.created_at < $${idx}`)
      params.push(w.end)
      idx++
    }
  }
  if (f.after && isYmd(f.after)) {
    const w = dayWindow(f.after)
    if (w) {
      extra.push(`m.created_at >= $${idx}`)
      params.push(w.start)
      idx++
    }
  }
  // afterMs — millisecond-precise exclusive lower bound for watermark paging.
  if (typeof f.afterMs === 'number' && Number.isFinite(f.afterMs)) {
    extra.push(`m.created_at > $${idx}`)
    params.push(f.afterMs)
    idx++
  }

  // has:<type> — any-of.
  const has = Array.isArray(f.has) ? f.has : []
  if (has.includes('file') || has.includes('attachment')) {
    // deleted_at = 0: soft-deleted files (migration 033) must not satisfy has:file.
    extra.push(`EXISTS (SELECT 1 FROM aaelink.file_attachments fa WHERE fa.message_id = m.id AND fa.deleted_at = 0)`)
  }
  if (has.includes('pin')) {
    extra.push(`EXISTS (SELECT 1 FROM aaelink.pinned_messages pm2 WHERE pm2.message_id = m.id)`)
  }
  if (has.includes('reaction')) {
    extra.push(`EXISTS (SELECT 1 FROM aaelink.message_reactions r2 WHERE r2.message_id = m.id)`)
  }
  if (has.includes('link')) {
    extra.push(`m.body ~ 'https?://'`)
  }

  // is:thread / is:pinned / is:saved
  if (f.isThread) {
    extra.push(`m.root_id <> ''`)
  }
  if (f.isPinned) {
    extra.push(`EXISTS (SELECT 1 FROM aaelink.pinned_messages pm3 WHERE pm3.message_id = m.id)`)
  }
  if (f.isSaved) {
    extra.push(`EXISTS (SELECT 1 FROM aaelink.saved_messages sm WHERE sm.message_id = m.id AND sm.user_id = $1)`)
  }

  const visibility = visibilityClause(scope)
  const extraClause = extra.length ? ` AND ${extra.join(' AND ')}` : ''
  // Relevance ranking is meaningless with no FTS query, so filters-only mode
  // always orders newest-first unless the caller explicitly asked for oldest.
  const effectiveSort: SearchSort = useFts ? sort : (sort === 'oldest' ? 'oldest' : 'recent')
  const orderBy = effectiveSort === 'recent'
    ? `m.created_at DESC, rank DESC`
    : effectiveSort === 'oldest'
      ? `m.created_at ASC, rank DESC`
      : `rank DESC, m.created_at DESC`

  // With FTS the @@ predicate gates matches and ts_rank/ts_headline use $2; in
  // filters-only mode there is no tsquery so rank is a constant 0 and the
  // highlight degrades to a body prefix.
  const ftsPredicate = useFts ? `m.body_tsv @@ websearch_to_tsquery('english', $2)\n    AND ` : ''
  const rankExpr = useFts
    ? `ts_rank(m.body_tsv, websearch_to_tsquery('english', $2))`
    : `0::float4`
  const highlightExpr = useFts
    ? `ts_headline('english', m.body, websearch_to_tsquery('english', $2), '${HEADLINE_OPTS}')`
    : `LEFT(m.body, 200)`

  const whereCore = `
    ${ftsPredicate}${visibility}
    ${extraClause}
  `

  const sql = `
    SELECT
      m.id AS message_id,
      m.body,
      m.created_at,
      m.channel_id,
      COALESCE(m.root_id, '') AS root_id,
      c.display_name AS channel_name,
      c.type AS channel_type,
      c.workspace_id,
      c.org_id::text AS org_id,
      u.id AS author_id,
      u.username AS author_username,
      COALESCE(u.first_name, '') AS author_first_name,
      COALESCE(u.last_name, '') AS author_last_name,
      u.avatar_url AS author_avatar_url,
      ${rankExpr} AS rank,
      ${highlightExpr} AS highlight
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    JOIN aaelink.users u ON u.id = m.user_id
    WHERE ${whereCore}
    ORDER BY ${orderBy}
    LIMIT $${idx} OFFSET $${idx + 1}
  `
  const queryParams = [...params, limit, offset]

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    JOIN aaelink.users u ON u.id = m.user_id
    WHERE ${whereCore}
  `

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<Record<string, unknown>>(sql, queryParams),
    pool.query<{ total: number }>(countSql, params),
  ])

  return {
    results: rows.map((r): SearchEngineHit => ({
      message_id: String(r.message_id),
      body: String(r.body || ''),
      highlight: String(r.highlight || '') || String(r.body || '').slice(0, 200),
      created_at: Number(r.created_at),
      channel_id: String(r.channel_id),
      channel_name: String(r.channel_name || ''),
      channel_type: String(r.channel_type || ''),
      workspace_id: String(r.workspace_id || ''),
      org_id: r.org_id == null ? null : String(r.org_id),
      root_id: r.root_id ? String(r.root_id) : null,
      author_id: String(r.author_id || ''),
      author_username: String(r.author_username || ''),
      author_first_name: String(r.author_first_name || ''),
      author_last_name: String(r.author_last_name || ''),
      author_avatar_url: r.author_avatar_url == null ? null : String(r.author_avatar_url),
      rank: Number(r.rank) || 0,
    })),
    total: countRows[0]?.total ?? 0,
    limit,
    offset,
  }
}
