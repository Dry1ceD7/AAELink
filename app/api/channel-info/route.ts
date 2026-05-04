import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/** GET /api/channel-info?channel_id=... — get channel details (purpose, header, member count, pinned count). */
export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const { rows } = await pool.query<{
    id: string; name: string; display_name: string; type: string
    purpose: string; header: string; created_at: string
  }>(
    `SELECT id, name, display_name, type, purpose, header, created_at::text AS created_at
     FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  const ch = rows[0]
  if (!ch) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { rows: memberRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.workspace_members wm
     JOIN aaelink.channels c ON c.workspace_id = wm.workspace_id
     WHERE c.id = $1`,
    [channelId]
  )
  const memberCount = Number(memberRows[0]?.cnt || 0)

  const { rows: pinRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.pinned_messages WHERE channel_id = $1`,
    [channelId]
  )
  const pinnedCount = Number(pinRows[0]?.cnt || 0)

  return NextResponse.json({
    channel: {
      ...ch,
      created_at: Number(ch.created_at),
      member_count: memberCount,
      pinned_count: pinnedCount
    }
  })
}

/** PATCH /api/channel-info — update channel purpose/header.  Body: { channel_id, purpose?, header? } */
export async function PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; purpose?: string; header?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const { channel_id } = body
  if (!channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const sets: string[] = []
  const vals: (string | number)[] = []
  let i = 1

  if (typeof body.purpose === 'string') {
    sets.push(`purpose = $${i++}`)
    vals.push(body.purpose.slice(0, 500))
  }
  if (typeof body.header === 'string') {
    sets.push(`header = $${i++}`)
    vals.push(body.header.slice(0, 500))
  }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  vals.push(channel_id)
  await pool.query(
    `UPDATE aaelink.channels SET ${sets.join(', ')} WHERE id = $${i}`,
    vals
  )

  return NextResponse.json({ ok: true })
}
