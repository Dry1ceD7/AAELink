import type { Pool } from 'pg'
import type { ReactionSummary } from '@/lib/messaging/reactions'
import type { ChatPost, ReadReceipt } from '@/lib/realtime/realtime'

/** Cap on readers surfaced per message in the reader avatar stack. */
const MAX_READ_RECEIPTS = 5

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

export function rowToPost(
  row: MessageRowInput,
  reactions?: ReactionSummary[],
  readReceipts?: ReadReceipt[]
): ChatPost {
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
  if (readReceipts?.length) post.read_receipts = readReceipts
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

/**
 * Most recent readers (up to {@link MAX_READ_RECEIPTS}) for each message, newest
 * first. Returns an empty map when there are no message ids so callers can skip
 * the read-receipt query on cold channels.
 */
export async function readReceiptsForMessages(
  pool: Pool,
  messageIds: string[]
): Promise<Map<string, ReadReceipt[]>> {
  const map = new Map<string, ReadReceipt[]>()
  if (messageIds.length === 0) return map
  const { rows } = await pool.query<{
    message_id: string
    user_id: string
    read_at: string
  }>(
    `SELECT message_id, user_id, read_at
       FROM (
         SELECT message_id, user_id, read_at,
                ROW_NUMBER() OVER (
                  PARTITION BY message_id ORDER BY read_at DESC, user_id
                ) AS rn
         FROM aaelink.message_reads
         WHERE message_id = ANY($1::text[])
       ) ranked
      WHERE rn <= $2
      ORDER BY message_id, read_at DESC, user_id`,
    [messageIds, MAX_READ_RECEIPTS]
  )
  for (const row of rows) {
    const list = map.get(row.message_id) ?? []
    list.push({ user_id: row.user_id, read_at: Number(row.read_at) || 0 })
    map.set(row.message_id, list)
  }
  return map
}

/**
 * Read-receipt deltas for a channel: the current reader stack for every message
 * whose reads advanced past `sinceReadAt`. Powers the SSE / poll fan-out in
 * `GET /api/collab/events` so reader avatar stacks update live without a full
 * message refetch.
 *
 * Returns the touched-message stacks (`message_id` → readers, newest first, same
 * shape as {@link readReceiptsForMessages}) plus `nextWatermark` — the cursor to
 * feed back on the next tick, or `sinceReadAt` when nothing advanced.
 *
 * `nowMs` (defaults to the wall clock) is the cursor ceiling: a read whose
 * `read_at` equals the current millisecond may still be committing after this
 * query's MVCC snapshot, so the watermark is never advanced up to `nowMs`. On a
 * quiet channel the max read is already in the settled past, so this is a no-op
 * (no perpetual re-delivery); only same-millisecond-as-now reads get one extra,
 * idempotent re-scan on the following tick.
 */
export async function readReceiptDeltaSince(
  pool: Pool,
  channelId: string,
  sinceReadAt: number,
  limit = 200,
  nowMs: number = Date.now()
): Promise<{ map: Record<string, ReadReceipt[]>; nextWatermark: number }> {
  const { rows } = await pool.query<{ message_id: string; mr: string }>(
    `SELECT message_id, MAX(read_at)::text AS mr FROM aaelink.message_reads
     WHERE channel_id = $1 AND read_at > $2
     GROUP BY message_id ORDER BY mr ASC LIMIT $3`,
    [channelId, sinceReadAt, limit]
  )
  if (rows.length === 0) return { map: {}, nextWatermark: sinceReadAt }
  const ids = rows.map(r => r.message_id)
  const receipts = await readReceiptsForMessages(pool, ids)
  const map: Record<string, ReadReceipt[]> = {}
  for (const id of ids) map[id] = receipts.get(id) ?? []
  let maxMr = sinceReadAt
  for (const r of rows) {
    const n = Number(r.mr)
    if (Number.isFinite(n) && n > maxMr) maxMr = n
  }
  // When the page cap was hit, the tail beyond `limit` — plus any messages tying
  // the largest returned read_at — would be skipped by the next strict `> cursor`.
  // Hold the watermark one ms below the max so that tail is re-scanned next tick.
  let nextWatermark = rows.length >= limit ? maxMr - 1 : maxMr
  // Same-millisecond straddle guard: keep the cursor strictly in the settled past
  // so a concurrent read at the current ms (not yet visible in this snapshot) is
  // not skipped by the next tick's strict `> cursor`.
  nextWatermark = Math.min(nextWatermark, nowMs - 1)
  // Never regress below the incoming cursor (re-delivered stacks are idempotent).
  nextWatermark = Math.max(nextWatermark, sinceReadAt)
  return { map, nextWatermark }
}
