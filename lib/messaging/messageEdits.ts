/**
 * D3 Messaging — message edit history.
 *
 * Each time a message body is edited, the body as it was BEFORE the edit is
 * captured here. The UI uses the presence of any row as the "edited" indicator
 * and can render the full history. Records are immutable; deleting a message
 * cascades its history away.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export interface MessageEdit {
  id: string
  editor_id: string | null
  previous_body: string
  edited_at: number
}

/**
 * Record one edit: store the body as it was before the change. Call AFTER
 * confirming the edit is authorized, passing the previous (pre-edit) body.
 */
export async function recordMessageEdit(
  pool: Pool,
  params: { messageId: string; channelId: string; editorId: string; previousBody: string; editedAt: number }
): Promise<void> {
  await pool.query(
    `INSERT INTO aaelink.message_edits (id, message_id, channel_id, editor_id, previous_body, edited_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), params.messageId, params.channelId, params.editorId, params.previousBody, params.editedAt]
  )
}

/** List a message's prior versions, newest edit first. Caller enforces channel visibility. */
export async function listMessageEdits(pool: Pool, messageId: string): Promise<MessageEdit[]> {
  const { rows } = await pool.query<{ id: string; editor_id: string | null; previous_body: string; edited_at: string }>(
    `SELECT id, editor_id, previous_body, edited_at::text AS edited_at
       FROM aaelink.message_edits
      WHERE message_id = $1
      ORDER BY edited_at DESC`,
    [messageId]
  )
  return rows.map(r => ({ id: r.id, editor_id: r.editor_id, previous_body: r.previous_body, edited_at: Number(r.edited_at) }))
}

/** Number of times a message has been edited (the "edited" indicator count). */
export async function messageEditCount(pool: Pool, messageId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.message_edits WHERE message_id = $1`,
    [messageId]
  )
  return Number(rows[0]?.n ?? 0)
}
