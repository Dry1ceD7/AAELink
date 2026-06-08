import { NextResponse } from 'next/server'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { getPubSub, channelTopic } from '@/lib/realtime/redisPubSub'
import { log } from '@/lib/infra/log'
import type { MessageReadEvent } from '@/lib/realtime/realtime'

/**
 * Mark a message as read by the calling member.
 *
 * Upserts a single (user, message) read row, writes an audit entry, and fans the
 * read receipt out to channel subscribers so reader avatar stacks update live.
 * Idempotent — repeated reads keep the earliest `read_at` so the receipt reflects
 * when the member first saw the message.
 */
async function _POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: messageId } = await ctx.params
  if (!messageId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })

  const mr = await pool.query<{ channel_id: string; user_id: string }>(
    `SELECT channel_id, user_id FROM aaelink.messages WHERE id = $1`,
    [messageId]
  )
  const row = mr.rows[0]
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const channelId = row.channel_id
  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Authors do not "read" their own messages — nothing to record or fan out.
  if (row.user_id === uid) {
    return NextResponse.json({ message_id: messageId, read_at: 0, recorded: false })
  }

  const now = Date.now()
  // Keep the earliest read timestamp so the receipt reflects first sight.
  const upsert = await pool.query<{ read_at: string }>(
    `INSERT INTO aaelink.message_reads (user_id, message_id, channel_id, read_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO NOTHING
     RETURNING read_at`,
    [uid, messageId, channelId, now]
  )
  const inserted = (upsert.rowCount ?? 0) > 0
  const readAt = inserted ? now : await firstReadAt(pool, uid, messageId)

  // Already read on a prior request — stay quiet to avoid duplicate fan-out.
  if (!inserted) {
    return NextResponse.json({ message_id: messageId, read_at: readAt, recorded: false })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'message.read',
    resourceKind: 'message',
    resourceId: messageId,
    metadata: { channel_id: channelId },
  })

  try {
    const payload: MessageReadEvent = {
      type: 'message_read',
      channel_id: channelId,
      message_id: messageId,
      user_id: uid,
      read_at: now,
    }
    await getPubSub().publish(channelTopic(channelId), {
      type: 'channel_update',
      channel_id: channelId,
      payload,
    })
  } catch (err) {
    log.warn('message_read.emit_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return NextResponse.json({ message_id: messageId, read_at: now, recorded: true })
}

async function firstReadAt(
  pool: NonNullable<ReturnType<typeof getPool>>,
  userId: string,
  messageId: string
): Promise<number> {
  const { rows } = await pool.query<{ read_at: string }>(
    `SELECT read_at FROM aaelink.message_reads WHERE user_id = $1 AND message_id = $2`,
    [userId, messageId]
  )
  return Number(rows[0]?.read_at) || 0
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/messages/:id/read', _POST)
