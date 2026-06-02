import type { Pool } from 'pg'
import type { ReactionSummary } from '@/lib/messaging/reactions'
import type { ChatPost } from '@/lib/realtime/realtime'

export type MessageRowInput = {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: string | number
  updated_at?: string | number | null
  root_id?: string
  reply_count?: string | number | null
  /** System message type — '' or null = normal user message */
  type?: string | null
}

export function rowToPost(row: MessageRowInput, reactions?: ReactionSummary[]): ChatPost {
  const create_at = Number(row.create_at)
  const updated = row.updated_at != null ? Number(row.updated_at) : create_at
  const post: ChatPost = {
    id: row.id,
    channel_id: row.channel_id,
    user_id: row.user_id,
    message: row.message,
    create_at,
    root_id: row.root_id || ''
  }
  if (row.reply_count != null) {
    const n = Number(row.reply_count)
    if (Number.isFinite(n)) post.reply_count = n
  }
  if (reactions?.length) post.reactions = reactions
  if (updated > create_at) post.edited_at = updated
  const t = String(row.type || '').trim()
  if (t) post.type = t
  return post
}

export async function reactionSummariesForMessages(
  pool: Pool,
  viewerId: string,
  messageIds: string[]
): Promise<Map<string, ReactionSummary[]>> {
  const map = new Map<string, ReactionSummary[]>()
  if (messageIds.length === 0) return map
  const { rows } = await pool.query<{
    message_id: string
    reaction_key: string
    cnt: string
    me: boolean
  }>(
    `SELECT message_id, reaction_key,
            COUNT(*)::int AS cnt,
            BOOL_OR(user_id = $2::text) AS me
     FROM aaelink.message_reactions
     WHERE message_id = ANY($1::text[])
     GROUP BY message_id, reaction_key`,
    [messageIds, viewerId]
  )
  for (const row of rows) {
    const list = map.get(row.message_id) ?? []
    list.push({
      key: row.reaction_key,
      count: Number(row.cnt) || 0,
      me: Boolean(row.me)
    })
    map.set(row.message_id, list)
  }
  return map
}
