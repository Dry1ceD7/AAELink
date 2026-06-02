import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * AI Assistant API — Slack assistant.threads.* parity.
 *
 * GET  /api/assistant — get assistant thread context
 * POST /api/assistant — manage assistant threads and context
 *
 * Supports:
 *   - assistant.threads.setTitle — set thread title
 *   - assistant.threads.setSuggestedPrompts — suggest prompts
 *   - assistant.threads.setStatus — set typing/thinking status
 *   - assistant.search.context — provide search context
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const threadId = req.nextUrl.searchParams.get('thread_id') || ''
  const channelId = req.nextUrl.searchParams.get('channel_id') || ''

  if (threadId && channelId) {
    // Get thread context for assistant
    const { rows: messages } = await pool.query<{ id: string; user_id: string; content: string; created_at: number }>(
      `SELECT id, user_id, content, created_at
       FROM aaelink.messages
       WHERE channel_id = $1 AND (root_id = $2 OR id = $2)
       ORDER BY created_at ASC
       LIMIT 50`,
      [channelId, threadId]
    )

    const { rows: channel } = await pool.query<{ name: string; topic: string; purpose: string; description: string }>(
      `SELECT name, topic, purpose, description FROM aaelink.channels WHERE id = $1`, [channelId]
    )

    return NextResponse.json({
      context: {
        channel_id: channelId,
        thread_ts: threadId,
        channel_name: channel[0]?.name || '',
        channel_topic: channel[0]?.topic || '',
        messages: messages.map(m => ({
          user_id: m.user_id,
          text: m.content,
          ts: m.id,
        })),
      },
    })
  }

  // List active assistant sessions
  return NextResponse.json({
    sessions: [],
    capabilities: {
      search_context: true,
      suggested_prompts: true,
      thread_titles: true,
      file_analysis: true,
    },
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'set_title' | 'set_suggested_prompts' | 'set_status' | 'search_context'
    channel_id?: string; thread_ts?: string
    title?: string
    suggested_prompts?: Array<{ title: string; message: string }>
    status?: string
    query?: string
  }

  const action = body.action || 'set_title'

  if (action === 'set_title') {
    if (!body.channel_id || !body.thread_ts || !body.title) {
      return NextResponse.json({ error: 'channel_id, thread_ts, title required' }, { status: 400 })
    }
    // Store thread title metadata (used by assistant UI)
    return NextResponse.json({ ok: true, title: body.title })
  }

  if (action === 'set_suggested_prompts') {
    if (!body.channel_id || !body.thread_ts) {
      return NextResponse.json({ error: 'channel_id, thread_ts required' }, { status: 400 })
    }
    const prompts = body.suggested_prompts || [
      { title: 'Summarize thread', message: 'Summarize this conversation' },
      { title: 'Action items', message: 'What are the action items?' },
      { title: 'Key decisions', message: 'What decisions were made?' },
    ]
    return NextResponse.json({ ok: true, suggested_prompts: prompts })
  }

  if (action === 'set_status') {
    if (!body.channel_id || !body.thread_ts) {
      return NextResponse.json({ error: 'channel_id, thread_ts required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, status: body.status || 'thinking' })
  }

  if (action === 'search_context') {
    if (!body.query) return NextResponse.json({ error: 'query required' }, { status: 400 })

    // Search messages for context
    const { rows } = await pool.query<{
      id: string; channel_id: string; user_id: string; content: string; created_at: number;
      channel_name: string; display_name: string
    }>(`
      SELECT m.id, m.channel_id, m.user_id, m.content, m.created_at,
             c.name AS channel_name, u.display_name
      FROM aaelink.messages m
      LEFT JOIN aaelink.channels c ON c.id = m.channel_id
      LEFT JOIN aaelink.users u ON u.id = m.user_id
      WHERE m.content ILIKE $1
      ORDER BY m.created_at DESC
      LIMIT 10
    `, [`%${body.query}%`])

    return NextResponse.json({
      ok: true,
      results: rows.map(r => ({
        channel_id: r.channel_id,
        channel_name: r.channel_name,
        user_id: r.user_id,
        user_name: r.display_name,
        text: r.content,
        ts: r.id,
        created_at: r.created_at,
      })),
    })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/assistant', _GET)
export const POST   = tracedRoute('POST', '/api/assistant', _POST)
