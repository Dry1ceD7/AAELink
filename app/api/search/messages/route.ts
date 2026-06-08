import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { searchMessages, type SearchHasFilter } from '@/lib/messaging/searchEngine'

/**
 * GET /api/search/messages?q=...&workspace_id=...&channel_id=...&channel_name=...
 *   &from=...&before=...&after=...&on=...&during=...&has=...&is=...
 *   &sort=relevance|recent&limit=...&offset=...
 *
 * Full-text message search across channels the caller can read. Thin wrapper
 * over the shared FTS engine (lib/messaging/searchEngine.ts). All existing
 * params (q, workspace_id, channel_id, from, before, after, has) keep working;
 * channel_name, on, during, is (thread/pinned/saved/dm), and sort are additive.
 */
const HAS_VALUES: SearchHasFilter[] = ['file', 'attachment', 'pin', 'reaction', 'link']

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim() || ''
  if (!q || q.length < 2) return NextResponse.json({ results: [], total: 0 })

  // has= may repeat (?has=file&has:link) or be a single value.
  const hasParams = sp.getAll('has').map(h => h.toLowerCase())
  const has = HAS_VALUES.filter(v => hasParams.includes(v))

  // is= may repeat: is=thread&is=pinned&is=saved
  const isParams = new Set(sp.getAll('is').map(s => s.toLowerCase()))

  const result = await searchMessages(pool, {
    uid,
    q,
    workspaceId: sp.get('workspace_id') || '',
    sort: sp.get('sort') === 'recent' ? 'recent' : 'relevance',
    limit: Number(sp.get('limit')) || 25,
    offset: Number(sp.get('offset')) || 0,
    filters: {
      channelId: sp.get('channel_id') || undefined,
      channelName: sp.get('channel_name') || undefined,
      fromUser: sp.get('from') || undefined,
      before: sp.get('before') || undefined,
      after: sp.get('after') || undefined,
      on: sp.get('on') || undefined,
      during: sp.get('during') || undefined,
      has,
      isThread: isParams.has('thread'),
      isPinned: isParams.has('pinned'),
      isSaved: isParams.has('saved'),
      isDm: isParams.has('dm'),
    },
  })

  return NextResponse.json(result)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/messages', _GET)
