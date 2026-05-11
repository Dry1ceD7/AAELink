import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/messages/permalink?message_id=...
 *
 * Generates a permanent URL for a specific message, resolving its
 * workspace, channel, and thread context. This allows deep-linking
 * from notifications, search results, and external integrations.
 *
 * Response:
 *   { permalink, workspace_id, channel_id, channel_name,
 *     message_id, root_id, is_thread_reply }
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const messageId = req.nextUrl.searchParams.get('message_id')?.trim() || ''
  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })

  // Resolve the message and its context
  const { rows } = await pool.query<{
    id: string
    channel_id: string
    root_id: string
    workspace_id: string
    channel_name: string
    channel_display: string
    channel_type: string
  }>(`
    SELECT m.id, m.channel_id, COALESCE(NULLIF(TRIM(m.root_id), ''), '') AS root_id,
           c.workspace_id, c.name AS channel_name, c.display_name AS channel_display,
           c.type AS channel_type
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    WHERE m.id = $1
  `, [messageId])

  if (!rows[0]) return NextResponse.json({ error: 'message_not_found' }, { status: 404 })

  const msg = rows[0]
  const isThreadReply = msg.root_id.length > 0

  // Get the app URL for building the permalink
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://aaelink.local').replace(/\/+$/, '')

  // Build permalink path:
  //   /workspace/{id}/channel/{id}[/thread/{root_id}]?focus={message_id}
  let path = `/collab/${msg.workspace_id}/channel/${msg.channel_id}`
  if (isThreadReply) {
    path += `/thread/${msg.root_id}`
  }
  path += `?focus=${msg.id}`

  const permalink = `${appUrl}${path}`

  return NextResponse.json({
    permalink,
    workspace_id: msg.workspace_id,
    channel_id: msg.channel_id,
    channel_name: msg.channel_display || msg.channel_name,
    message_id: msg.id,
    root_id: msg.root_id || null,
    is_thread_reply: isThreadReply
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/messages/permalink', _GET)
