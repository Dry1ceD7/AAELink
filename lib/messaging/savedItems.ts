/**
 * D3 Messaging — saved / "Later" items per user.
 *
 * A user saves any message they can see to a personal list and moves it through
 * states (saved -> in_progress -> completed -> archived), the Slack "Later"
 * surface. Saving is visibility-gated: the user must belong to the message's
 * channel. One row per (user, message); re-saving refreshes the timestamp but
 * preserves the existing state and note.
 */
import type { Pool } from 'pg'

export type SavedItemState = 'saved' | 'in_progress' | 'completed' | 'archived'
export const SAVED_ITEM_STATES: SavedItemState[] = ['saved', 'in_progress', 'completed', 'archived']

export function isSavedItemState(v: string): v is SavedItemState {
  return (SAVED_ITEM_STATES as string[]).includes(v)
}

/** Load a message's channel and whether the user is a member of it. */
async function messageVisibleTo(
  pool: Pool,
  uid: string,
  messageId: string
): Promise<{ exists: boolean; visible: boolean }> {
  const { rows } = await pool.query<{ is_member: boolean }>(
    `SELECT (cm.user_id IS NOT NULL) AS is_member
       FROM aaelink.messages m
       LEFT JOIN aaelink.channel_members cm
         ON cm.channel_id = m.channel_id AND cm.user_id = $1
      WHERE m.id = $2`,
    [uid, messageId]
  )
  if (rows.length === 0) return { exists: false, visible: false }
  return { exists: true, visible: rows[0].is_member }
}

export type SaveItemResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'not_found' | 'forbidden' }

/**
 * Save a message to the user's Later list. Re-saving an existing item refreshes
 * saved_at but keeps its state/note. Requires the user to be a member of the
 * message's channel.
 */
export async function saveItem(
  pool: Pool,
  uid: string,
  messageId: string,
  note = ''
): Promise<SaveItemResult> {
  const v = await messageVisibleTo(pool, uid, messageId)
  if (!v.exists) return { ok: false, code: 'not_found' }
  if (!v.visible) return { ok: false, code: 'forbidden' }

  await pool.query(
    `INSERT INTO aaelink.saved_items (user_id, message_id, note, saved_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO UPDATE SET saved_at = $4`,
    [uid, messageId, note, Date.now()]
  )
  return { ok: true, messageId }
}

/** Remove a message from the user's Later list. False when it was not saved. */
export async function unsaveItem(pool: Pool, uid: string, messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.saved_items WHERE user_id = $1 AND message_id = $2`,
    [uid, messageId]
  )
  return (rowCount ?? 0) > 0
}

export type SetStateResult =
  | { ok: true; messageId: string; state: SavedItemState }
  | { ok: false; code: 'not_found' | 'invalid_state' }

/** Move a saved item to a new state. */
export async function setSavedItemState(
  pool: Pool,
  uid: string,
  messageId: string,
  state: string
): Promise<SetStateResult> {
  if (!isSavedItemState(state)) return { ok: false, code: 'invalid_state' }
  const { rowCount } = await pool.query(
    `UPDATE aaelink.saved_items SET state = $3 WHERE user_id = $1 AND message_id = $2`,
    [uid, messageId, state]
  )
  if (!rowCount) return { ok: false, code: 'not_found' }
  return { ok: true, messageId, state }
}

export interface SavedItem {
  message_id: string
  channel_id: string
  state: SavedItemState
  note: string
  saved_at: number
  body: string
  author_id: string
  message_created_at: number
}

/**
 * List the user's saved items (optionally filtered by state), newest first, with
 * a snapshot of the message. Excludes items whose message has since been deleted
 * (the FK cascade removes those rows anyway).
 */
export async function listSavedItems(
  pool: Pool,
  uid: string,
  state?: string
): Promise<SavedItem[]> {
  const filterState = state && isSavedItemState(state) ? state : null
  const { rows } = await pool.query<{
    message_id: string; channel_id: string; state: SavedItemState; note: string
    saved_at: string; body: string; author_id: string; message_created_at: string
  }>(
    `SELECT s.message_id, m.channel_id, s.state, s.note,
            s.saved_at::text AS saved_at,
            m.body, m.user_id AS author_id, m.created_at::text AS message_created_at
       FROM aaelink.saved_items s
       JOIN aaelink.messages m ON m.id = s.message_id
      WHERE s.user_id = $1
        AND ($2::text IS NULL OR s.state = $2)
      ORDER BY s.saved_at DESC`,
    [uid, filterState]
  )
  return rows.map(r => ({
    message_id: r.message_id,
    channel_id: r.channel_id,
    state: r.state,
    note: r.note,
    saved_at: Number(r.saved_at),
    body: r.body,
    author_id: r.author_id,
    message_created_at: Number(r.message_created_at),
  }))
}
