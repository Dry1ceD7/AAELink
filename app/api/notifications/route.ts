import { NextResponse } from 'next/server'
import type { ApiNotification } from '@/lib/notificationTypes'
import { userCanReadChannel } from '@/lib/collab-access'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import type { Pool } from 'pg'

async function unreadCountForUser(pool: Pool, userId: string): Promise<number> {
  const { rows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM aaelink.notifications WHERE user_id = $1 AND read_at = 0`,
    [userId]
  )
  return Number(rows[0]?.c) || 0
}

export async function GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { rows: list } = await pool.query<{
    id: string
    kind: string
    title: string
    body: string
    workspace_id: string
    channel_id: string | null
    message_id: string | null
    ticket_id: string | null
    read_at: string
    created_at: string
  }>(
    `SELECT id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at
     FROM aaelink.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [uid]
  )
  const { rows: cr } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM aaelink.notifications WHERE user_id = $1 AND read_at = 0`,
    [uid]
  )
  const unread_count = Number(cr[0]?.c) || 0
  const notifications: ApiNotification[] = list.map(r => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    workspace_id: r.workspace_id,
    channel_id: r.channel_id,
    message_id: r.message_id,
    ticket_id: r.ticket_id,
    read_at: Number(r.read_at) || 0,
    created_at: Number(r.created_at) || 0
  }))
  return NextResponse.json({ notifications, unread_count })
}

export async function PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as {
    read_all?: boolean
    ids?: string[]
    mark_channel?: { workspace_id?: string; channel_id?: string }
    mark_thread?: { workspace_id?: string; channel_id?: string; thread_root_id?: string }
    mark_ticket?: { workspace_id?: string; ticket_id?: string }
  }
  const now = Date.now()

  const mc = body.mark_channel
  if (mc && typeof mc.workspace_id === 'string' && typeof mc.channel_id === 'string') {
    const ws = mc.workspace_id.trim()
    const ch = mc.channel_id.trim()
    if (ws && ch) {
      await pool.query(
        `UPDATE aaelink.notifications SET read_at = $1
         WHERE user_id = $2 AND read_at = 0 AND workspace_id = $3 AND channel_id = $4
           AND (message_id IS NULL OR message_id = '')`,
        [now, uid, ws, ch]
      )
      const unread_count = await unreadCountForUser(pool, uid)
      return NextResponse.json({ ok: true, unread_count })
    }
  }

  const mth = body.mark_thread
  if (
    mth &&
    typeof mth.workspace_id === 'string' &&
    typeof mth.channel_id === 'string' &&
    typeof mth.thread_root_id === 'string'
  ) {
    const ws = mth.workspace_id.trim()
    const ch = mth.channel_id.trim()
    const root = mth.thread_root_id.trim()
    if (ws && ch && root) {
      if (!(await userCanReadChannel(pool, uid, ch))) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      await pool.query(
        `UPDATE aaelink.notifications SET read_at = $1
         WHERE user_id = $2 AND read_at = 0 AND workspace_id = $3 AND channel_id = $4
           AND COALESCE(NULLIF(TRIM(message_id), ''), '') <> ''
           AND (
             message_id = $5
             OR message_id IN (
               SELECT m.id FROM aaelink.messages m
               WHERE m.channel_id = $4 AND (m.id = $5 OR m.root_id = $5)
             )
           )`,
        [now, uid, ws, ch, root]
      )
      const unread_count = await unreadCountForUser(pool, uid)
      return NextResponse.json({ ok: true, unread_count })
    }
  }

  const mt = body.mark_ticket
  if (mt && typeof mt.workspace_id === 'string' && typeof mt.ticket_id === 'string') {
    const ws = mt.workspace_id.trim()
    const tid = mt.ticket_id.trim()
    if (ws && tid) {
      await pool.query(
        `UPDATE aaelink.notifications SET read_at = $1
         WHERE user_id = $2 AND read_at = 0 AND workspace_id = $3 AND ticket_id = $4`,
        [now, uid, ws, tid]
      )
      const unread_count = await unreadCountForUser(pool, uid)
      return NextResponse.json({ ok: true, unread_count })
    }
  }

  if (body.read_all === true) {
    await pool.query(
      `UPDATE aaelink.notifications SET read_at = $1 WHERE user_id = $2 AND read_at = 0`,
      [now, uid]
    )
    const unread_count = await unreadCountForUser(pool, uid)
    return NextResponse.json({ ok: true, unread_count })
  }

  const ids = Array.isArray(body.ids) ? body.ids.map(x => String(x || '').trim()).filter(Boolean) : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids_or_read_all_required' }, { status: 400 })
  await pool.query(
    `UPDATE aaelink.notifications SET read_at = $1
     WHERE user_id = $2 AND id = ANY($3::text[]) AND read_at = 0`,
    [now, uid, ids]
  )
  const unread_count = await unreadCountForUser(pool, uid)
  return NextResponse.json({ ok: true, unread_count })
}
