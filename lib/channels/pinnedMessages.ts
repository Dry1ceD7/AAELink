import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

/**
 * Pinned message lifecycle management.
 *
 * Handles pinning / unpinning messages in channels with
 * audit trail entries for compliance.
 */

export interface PinnedMessage {
  channel_id: string
  message_id: string
  pinned_by: string
  pinned_at: number
}

export async function pinMessage(
  pool: Pool, channelId: string, messageId: string, userId: string
): Promise<void> {
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.pinned_messages (channel_id, message_id, pinned_by, pinned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id, message_id) DO NOTHING`,
    [channelId, messageId, userId, now]
  )

  // System message
  try {
    await pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, type, created_at, updated_at)
       VALUES ($1, $2, $3, '', '', 'system_pin', $4, $4)`,
      [randomUUID(), channelId, userId, now]
    )
  } catch { /* best-effort */ }

  writeAuditLog({ pool, actorId: userId, action: 'message.pin', resourceKind: 'message', resourceId: messageId, metadata: { channel_id: channelId } })
}

export async function unpinMessage(
  pool: Pool, channelId: string, messageId: string, userId: string
): Promise<void> {
  await pool.query(
    `DELETE FROM aaelink.pinned_messages WHERE channel_id = $1 AND message_id = $2`,
    [channelId, messageId]
  )
  writeAuditLog({ pool, actorId: userId, action: 'message.unpin', resourceKind: 'message', resourceId: messageId, metadata: { channel_id: channelId } })
}

export async function listPins(pool: Pool, channelId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT p.message_id, p.pinned_by, p.pinned_at,
            m.body, m.user_id AS author_id, m.created_at AS message_created_at,
            u.username AS author_username,
            pb.username AS pinned_by_username
     FROM aaelink.pinned_messages p
     JOIN aaelink.messages m ON m.id = p.message_id
     LEFT JOIN aaelink.users u ON u.id = m.user_id
     LEFT JOIN aaelink.users pb ON pb.id = p.pinned_by
     WHERE p.channel_id = $1
     ORDER BY p.pinned_at DESC
     LIMIT 100`,
    [channelId]
  )
  return rows
}
