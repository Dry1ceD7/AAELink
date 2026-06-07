import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import {
  notifyChannelMentions,
  notifyBroadcastMentions,
  notifyKeywordMatches,
  notifyChannelLevelAll,
  notifyDirectMessage,
  notifyThreadFollowers,
} from '@/lib/notifications/notificationsServer'
import { parseBroadcastMentions } from '@/lib/messaging/mentionParse'
import { emitMessageCreated } from '@/lib/webhooks/webhookEmitter'
import { rowToPost } from '@/lib/messaging/chat-post'
import { emitMessageEvent } from '@/app/api/messages/route'

/**
 * A pending scheduled-message row, as stored in aaelink.scheduled_messages.
 * `body` is the already-DLP-cleared body the caller intends to deliver.
 */
export type ScheduledMessageDelivery = {
  channelId: string
  userId: string
  body: string
  rootId: string
  /** Epoch-ms timestamp to stamp on the delivered message (the original send_at). */
  createdAt: number
}

/**
 * Insert a scheduled message into aaelink.messages and run the full post-insert
 * side-effect set — identical to the live POST /api/messages fan-out:
 *   - notification fan-out (mentions / broadcast / keyword / level-all, or DM)
 *   - thread-follower notifications when root_id is set
 *   - realtime pub/sub emit via emitMessageEvent (shared with the HTTP route)
 *   - outgoing-webhook emit via emitMessageCreated
 *   - channels.last_post_at update
 *
 * This is the single source of truth shared by BOTH delivery paths:
 *   - the in-process scheduledMessageProcessor (primary production sender), and
 *   - the HTTP POST /api/scheduled-messages/dispatch route.
 *
 * Callers are responsible for the pre-delivery guards (archived / post
 * permission / DLP) and for marking the scheduled row's status afterwards.
 *
 * Returns the id of the inserted message row.
 */
export async function deliverScheduledMessage(
  pool: Pool,
  msg: ScheduledMessageDelivery
): Promise<string> {
  const messageId = randomUUID()
  const rootId = msg.rootId || ''
  const createdAt = msg.createdAt

  // Insert the actual message row.
  await pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [messageId, msg.channelId, msg.userId, msg.body, rootId, createdAt]
  )

  // Bump the channel's last_post_at (monotonic). Best-effort: last_post_at is an
  // optional column not present in every schema revision — a missing column must
  // never abort delivery (notifications + realtime emit must still run). The live
  // POST /api/messages path does not depend on this column either.
  try {
    await pool.query(
      `UPDATE aaelink.channels SET last_post_at = GREATEST(last_post_at, $1) WHERE id = $2`,
      [createdAt, msg.channelId]
    )
  } catch (e) {
    console.error('[deliverScheduledMessage] last_post_at update skipped', e)
  }

  // Fan out to subscribed outgoing webhooks (no-op when none configured).
  try {
    await emitMessageCreated(pool, {
      channel_id: msg.channelId,
      message_id: messageId,
      user_id: msg.userId,
      content: msg.body,
    })
  } catch (e) {
    console.error('[deliverScheduledMessage] emitMessageCreated', e)
  }

  // Notification fan-out — mirrors the live POST /api/messages path.
  try {
    const { rows: chRows } = await pool.query<{
      workspace_id: string; display_name: string; name: string; type: string
    }>(`SELECT workspace_id, display_name, name, type FROM aaelink.channels WHERE id = $1`, [msg.channelId])
    const ch = chRows[0]
    const { rows: uRows } = await pool.query<{
      username: string; nickname: string; first_name: string; last_name: string
    }>(`SELECT username, nickname, first_name, last_name FROM aaelink.users WHERE id = $1`, [msg.userId])
    const ur = uRows[0]
    if (ch?.workspace_id && ur) {
      const fullName = `${ur.first_name || ''} ${ur.last_name || ''}`.trim()
      const authorLabel = fullName || ur.nickname || ur.username
      const isDm = ch.type === 'D' || ch.type === 'G'
      if (isDm) {
        await notifyDirectMessage({
          pool,
          workspaceId: ch.workspace_id,
          channelId: msg.channelId,
          messageId,
          authorId: msg.userId,
          authorLabel,
          body: msg.body,
        })
      } else {
        const labelBase = (ch.display_name || ch.name || 'channel').trim()
        const channelLabel = `#${labelBase}`
        const mentioned = await notifyChannelMentions({
          pool,
          workspaceId: ch.workspace_id,
          channelId: msg.channelId,
          channelLabel,
          messageId,
          authorId: msg.userId,
          authorLabel,
          body: msg.body,
        })
        const broadcastTokens = parseBroadcastMentions(msg.body)
        const broadcasted = await notifyBroadcastMentions({
          pool,
          workspaceId: ch.workspace_id,
          channelId: msg.channelId,
          channelLabel,
          messageId,
          senderId: msg.userId,
          senderLabel: authorLabel,
          body: msg.body,
          tokens: broadcastTokens,
          directMentionUserIds: mentioned,
        })
        const keyworded = await notifyKeywordMatches({
          pool,
          workspaceId: ch.workspace_id,
          channelId: msg.channelId,
          channelLabel,
          messageId,
          authorId: msg.userId,
          authorLabel,
          body: msg.body,
          excludeUserIds: [...mentioned, ...broadcasted],
        })
        await notifyChannelLevelAll({
          pool,
          workspaceId: ch.workspace_id,
          channelId: msg.channelId,
          channelLabel,
          messageId,
          authorId: msg.userId,
          authorLabel,
          body: msg.body,
          excludeUserIds: [...mentioned, ...broadcasted, ...keyworded],
        })
        // Thread reply: notify followers of the parent thread, deduplicated
        // against direct @mention recipients (mention wins).
        if (rootId) {
          await notifyThreadFollowers({
            pool,
            workspaceId: ch.workspace_id,
            channelId: msg.channelId,
            channelLabel,
            threadId: rootId,
            replyId: messageId,
            replierId: msg.userId,
            replierLabel: authorLabel,
            body: msg.body,
            directMentionUserIds: mentioned,
          })
        }
      }
    }
  } catch (notifyErr: unknown) {
    console.error(`[deliverScheduledMessage] notification fan-out failed for ${messageId}:`, notifyErr)
  }

  // Realtime: fan out the new message to WS subscribers on this channel —
  // same mechanism as the live POST /api/messages route (Hard Rule #6).
  await emitMessageEvent(rowToPost({
    id: messageId,
    channel_id: msg.channelId,
    user_id: msg.userId,
    message: msg.body,
    create_at: createdAt,
    updated_at: createdAt,
    root_id: rootId,
    reply_count: rootId ? undefined : 0,
  }))

  return messageId
}
