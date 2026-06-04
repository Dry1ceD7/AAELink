import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { searchMessages } from '@/lib/messaging/searchEngine'

const MAX_Q = 200
const DEFAULT_LIMIT = 30

/**
 * Workspace-wide message search (channels the caller can access).
 *
 * Runs on the shared FTS engine (lib/messaging/searchEngine.ts) — same engine
 * and grammar as /api/search/messages, scoped to the requested workspace. The
 * response shape ({ query, count, hits[] }) is preserved for SearchPanel.
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const url = new URL(req.url)
  const workspace_id = String(url.searchParams.get('workspace_id') || url.searchParams.get('team_id') || '').trim()
  const q = String(url.searchParams.get('q') || '').trim()
  // 50 = the engine's MAX_LIMIT; advertising more would be silently clamped.
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT))

  if (!workspace_id) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!q) return NextResponse.json({ error: 'q_required' }, { status: 400 })
  if (q.length > MAX_Q) return NextResponse.json({ error: 'q_too_long' }, { status: 400 })

  const member = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspace_id, uid]
  )
  if (member.rows.length === 0) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { results } = await searchMessages(pool, {
    uid,
    q,
    workspaceId: workspace_id,
    sort: 'recent',
    limit,
  })

  return NextResponse.json({
    query: q,
    count: results.length,
    hits: results.map(r => ({
      id: r.message_id,
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_display: r.channel_name,
      channel_type: r.channel_type,
      root_id: r.root_id,
      user_id: r.author_id,
      author_username: r.author_username,
      author_display_name: [r.author_first_name, r.author_last_name].filter(Boolean).join(' ') || r.author_username,
      author_avatar_url: r.author_avatar_url,
      snippet: r.body.length > 180 ? `${r.body.slice(0, 177)}...` : r.body,
      highlight: r.highlight,
      created_at: r.created_at,
    })),
  })
}

// ── Traced export ───────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/messages/search', _GET)
