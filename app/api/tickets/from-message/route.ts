import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { getMemberDepartmentId } from '@/lib/enterprise/ticketAccess'
import { calculateSlaDue, isTicketPriority, isTicketCategory, type TicketPriority, type TicketCategory } from '@/lib/enterprise/slaEngine'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * POST /api/tickets/from-message — create a ticket from a chat message.
 *
 * Body: { workspace_id, message_id, channel_id, title?, priority?, category? }
 */
async function _POST(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    workspace_id?: string
    message_id?: string
    channel_id?: string
    title?: string
    priority?: string
    category?: string
  }

  const workspaceId = String(body.workspace_id || '').trim()
  const messageId = String(body.message_id || '').trim()
  const channelId = String(body.channel_id || '').trim()

  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch the original message
  const { rows: msgRows } = await pool.query<{ body: string; user_id: string; created_at: string | number }>(
    `SELECT body, user_id, created_at FROM aaelink.messages WHERE id = $1`, [messageId]
  )
  const msg = msgRows[0]
  if (!msg) return NextResponse.json({ error: 'message_not_found' }, { status: 404 })

  // Fetch channel name for context
  const { rows: chRows } = await pool.query<{ display_name: string; name: string }>(
    `SELECT display_name, name FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  const channelName = chRows[0]?.display_name || chRows[0]?.name || 'unknown'

  // Fetch message author info
  const { rows: authorRows } = await pool.query<{ username: string }>(
    `SELECT username FROM aaelink.users WHERE id = $1`, [msg.user_id]
  )
  const authorUsername = authorRows[0]?.username || 'unknown'

  // Build ticket
  const title = String(body.title || '').trim()
    || `Ticket from #${channelName}: ${msg.body.replace(/<[^>]+>/g, '').slice(0, 80)}`
  const priority: TicketPriority = body.priority && isTicketPriority(body.priority) ? body.priority : 'medium'
  const category: TicketCategory = body.category && isTicketCategory(body.category) ? body.category : 'general'

  const now = Date.now()
  const ticketId = `T-${now}-${Math.random().toString(36).slice(2, 8)}`
  const deptId = await getMemberDepartmentId(pool, uid, workspaceId)
  const slaDueAt = calculateSlaDue(now, priority)

  // Create the ticket
  await pool.query(
    `INSERT INTO aaelink.tickets
       (id, workspace_id, title, description, status, priority, category, source,
        created_at, updated_at, created_by, department_id, tags, custom_fields,
        sla_due_at, source_message_id, source_channel_id)
     VALUES ($1,$2,$3,$4,'open',$5,$6,'chat',$7,$7,$8,$9,'[]','{}', $10,$11,$12)`,
    [ticketId, workspaceId, title, msg.body, priority, category,
     now, uid, deptId, slaDueAt, messageId, channelId]
  )

  // Add initial comment with context
  const contextNote = `📩 Created from message by @${authorUsername} in #${channelName}\n\n> ${msg.body.slice(0, 500)}`
  await pool.query(
    `INSERT INTO aaelink.ticket_comments (id, ticket_id, author_id, body, is_internal, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, $5, $5)`,
    [randomUUID(), ticketId, uid, contextNote, now]
  )

  // Activity log
  await pool.query(
    `INSERT INTO aaelink.ticket_activity_log (id, ticket_id, actor_id, action, meta, created_at)
     VALUES ($1, $2, $3, 'ticket_created_from_message', $4, $5)`,
    [randomUUID(), ticketId, uid,
     JSON.stringify({ source_message_id: messageId, source_channel_id: channelId, author: authorUsername }),
     now]
  )

  return NextResponse.json({
    ticket: {
      id: ticketId, workspace_id: workspaceId, title,
      description: msg.body, status: 'open', priority, category,
      source: 'chat', createdBy: uid, departmentId: deptId,
      slaDueAt, sourceMessageId: messageId, sourceChannelId: channelId,
      createdAt: now, updatedAt: now
    }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/tickets/from-message', _POST)
