import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { notifyTicketReply } from '@/lib/notificationsServer'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { canViewTicket } from '@/lib/ticketAccess'

function authorLabel(row: { username: string; nickname: string; first_name: string; last_name: string }) {
  const full = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  if (full) return full
  if (row.nickname) return row.nickname
  return row.username
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: ticketId } = await ctx.params
  const { rows: tw } = await pool.query<{
    workspace_id: string | null
    department_id: string | null
    created_by: string | null
    title: string
  }>(`SELECT workspace_id, department_id, created_by, title FROM aaelink.tickets WHERE id = $1`, [ticketId])
  const t = tw[0]
  if (!t?.workspace_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, t.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!(await canViewTicket(pool, uid, t))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = (await req.json()) as { body?: string }
  const bodyText = String(body.body || '').trim()
  if (!bodyText) return NextResponse.json({ error: 'body_required' }, { status: 400 })
  const now = Date.now()
  const mid = randomUUID()
  await pool.query(
    `INSERT INTO aaelink.ticket_messages (id, ticket_id, user_id, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [mid, ticketId, uid, bodyText, now]
  )
  await pool.query(`UPDATE aaelink.tickets SET updated_at = $1 WHERE id = $2`, [now, ticketId])

  try {
    const { rows: uRows } = await pool.query<{
      username: string
      nickname: string
      first_name: string
      last_name: string
    }>(`SELECT username, nickname, first_name, last_name FROM aaelink.users WHERE id = $1`, [uid])
    const ur = uRows[0]
    if (ur && t.workspace_id) {
      await notifyTicketReply({
        pool,
        workspaceId: t.workspace_id,
        ticketId,
        ticketTitle: t.title || 'Ticket',
        authorId: uid,
        authorLabel: authorLabel(ur),
        body: bodyText,
        createdBy: t.created_by
      })
    }
  } catch (e) {
    console.error('notifyTicketReply', e)
  }

  return NextResponse.json({ message: { id: mid, ticket_id: ticketId, user_id: uid, body: bodyText, createdAt: now } })
}
