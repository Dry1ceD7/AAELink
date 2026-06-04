// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { searchMessages, type SearchEngineFilters, type SearchHasFilter } from '@/lib/messaging/searchEngine'

/**
 * GET /api/search/advanced?q=...&workspace_id=...&sort=...&limit=...&offset=...
 *
 * Slack-style inline search operators parsed from `q`:
 *   from:username      — filter by author
 *   in:#channel-name   — filter by channel name
 *   has:link|reaction|pin|file|attachment
 *   before:YYYY-MM-DD  — messages before date
 *   after:YYYY-MM-DD   — messages after date
 *   on:YYYY-MM-DD      — messages on a single day
 *   during:YYYY[-MM]   — messages within a year or month
 *   is:thread          — only thread replies
 *   is:pinned          — only pinned messages
 *   is:saved           — only the caller's saved messages
 *
 * Remaining text after operators is the keyword (FTS) search. Execution runs on
 * the shared Postgres-FTS engine (lib/messaging/searchEngine.ts) — no more ILIKE.
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
  const sort = req.nextUrl.searchParams.get('sort') === 'relevance' ? 'relevance' : 'recent'

  // ── Parse inline operators into engine filters ──────────────────────
  const filters: SearchEngineFilters = {}
  const has = new Set<SearchHasFilter>()
  // Mirror of what we parsed, surfaced in the response for Slack-shaped clients.
  const echo: Record<string, unknown> = {}

  let keywords = raw
  keywords = keywords.replace(/from:(\S+)/gi, (_, u) => { filters.fromUser = u; echo.from = u; return '' })
  keywords = keywords.replace(/in:#?(\S+)/gi, (_, c) => { filters.channelName = c; echo.in = c; return '' })
  keywords = keywords.replace(/has:(link|reaction|pin|file|attachment)/gi, (_, t) => {
    const key = t.toLowerCase() as SearchHasFilter
    has.add(key)
    return ''
  })
  keywords = keywords.replace(/before:(\d{4}-\d{2}-\d{2})/gi, (_, d) => { filters.before = d; echo.before = d; return '' })
  keywords = keywords.replace(/after:(\d{4}-\d{2}-\d{2})/gi, (_, d) => { filters.after = d; echo.after = d; return '' })
  keywords = keywords.replace(/on:(\d{4}-\d{2}-\d{2})/gi, (_, d) => { filters.on = d; echo.on = d; return '' })
  keywords = keywords.replace(/during:(\d{4}(?:-\d{2})?)/gi, (_, d) => { filters.during = d; echo.during = d; return '' })
  keywords = keywords.replace(/is:thread/gi, () => { filters.isThread = true; echo.isThread = true; return '' })
  keywords = keywords.replace(/is:pinned/gi, () => { filters.isPinned = true; echo.isPinned = true; return '' })
  keywords = keywords.replace(/is:saved/gi, () => { filters.isSaved = true; echo.isSaved = true; return '' })
  keywords = keywords.replace(/\s+/g, ' ').trim()

  if (has.size) {
    filters.has = [...has]
    echo.has = [...has]
  }

  // A query with no free-text keyword but at least one operator (e.g.
  // `from:alice in:general`, `has:file`, `is:pinned`) is a first-class
  // advanced-search case — the legacy ILIKE route executed it with only the
  // filter predicates and returned matches, so the engine must too. Only a
  // genuinely-empty query (no keyword AND no operators) yields the empty shape.
  const hasAnyFilter = Object.keys(echo).length > 0
  if (keywords.length < 2 && !hasAnyFilter) {
    return NextResponse.json({ query: raw, keywords, filters: echo, results: [], total: 0, limit, offset })
  }

  const { results, total } = await searchMessages(pool, {
    uid,
    q: keywords,
    workspaceId,
    sort,
    limit,
    offset,
    filters,
  })

  return NextResponse.json({
    query: raw,
    keywords,
    filters: echo,
    results: results.map(r => ({
      message_id: r.message_id,
      body: r.body,
      snippet: r.body.length > 200 ? `${r.body.slice(0, 197)}...` : r.body,
      highlight: r.highlight,
      created_at: r.created_at,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_display: r.channel_name,
      channel_type: r.channel_type,
      root_id: r.root_id,
      author_id: r.author_id,
      author_username: r.author_username,
      author_display_name: [r.author_first_name, r.author_last_name].filter(Boolean).join(' ') || r.author_username,
      author_avatar_url: r.author_avatar_url,
    })),
    total,
    limit,
    offset,
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/advanced', _GET)
