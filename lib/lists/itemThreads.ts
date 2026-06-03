/**
 * D6 Lists — per-item discussion threads.
 *
 * Each list item carries a comment thread. Access follows the item's list: the
 * caller may participate when they created the list, or the list is attached to
 * a channel they can see (public channel, or one they are a member of). A
 * standalone list (no channel) is private to its creator. Comment authors (or
 * the list creator) may delete a comment.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

interface ItemListAccess {
  list_id: string
  channel_id: string
  list_creator: string
  visible: boolean
}

/** Resolve an item's list + whether the caller can access it. Null when the item is unknown. */
async function resolveItemAccess(pool: Pool, uid: string, itemId: string): Promise<ItemListAccess | null> {
  const { rows } = await pool.query<{
    list_id: string; channel_id: string; list_creator: string; visible: boolean
  }>(
    `SELECT l.id AS list_id,
            l.channel_id,
            l.created_by AS list_creator,
            (
              l.created_by = $1
              OR (
                l.channel_id <> '' AND EXISTS (
                  SELECT 1 FROM aaelink.channels c
                  WHERE c.id = l.channel_id
                    AND (
                      c.type = 'O'
                      OR EXISTS (
                        SELECT 1 FROM aaelink.channel_members cm
                        WHERE cm.channel_id = c.id AND cm.user_id = $1
                      )
                    )
                )
              )
            ) AS visible
       FROM aaelink.list_items i
       JOIN aaelink.lists l ON l.id = i.list_id
      WHERE i.id = $2`,
    [uid, itemId]
  )
  return rows[0] ?? null
}

export interface ListItemComment {
  id: string
  item_id: string
  user_id: string | null
  body: string
  created_at: number
}

export type AddCommentResult =
  | { ok: true; comment: ListItemComment }
  | { ok: false; code: 'not_found' | 'forbidden' | 'empty_body' }

/** Post a comment on a list item. Caller must be able to access the item's list. */
export async function addItemComment(
  pool: Pool,
  uid: string,
  itemId: string,
  body: string
): Promise<AddCommentResult> {
  const text = String(body || '').trim()
  if (!text) return { ok: false, code: 'empty_body' }

  const access = await resolveItemAccess(pool, uid, itemId)
  if (!access) return { ok: false, code: 'not_found' }
  if (!access.visible) return { ok: false, code: 'forbidden' }

  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.list_item_comments (id, item_id, list_id, user_id, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, itemId, access.list_id, uid, text, now]
  )
  return { ok: true, comment: { id, item_id: itemId, user_id: uid, body: text, created_at: now } }
}

export type ListCommentsResult =
  | { ok: true; comments: ListItemComment[] }
  | { ok: false; code: 'not_found' | 'forbidden' }

/** List an item's comments oldest-first. Caller must be able to access the item's list. */
export async function listItemComments(pool: Pool, uid: string, itemId: string): Promise<ListCommentsResult> {
  const access = await resolveItemAccess(pool, uid, itemId)
  if (!access) return { ok: false, code: 'not_found' }
  if (!access.visible) return { ok: false, code: 'forbidden' }

  const { rows } = await pool.query<{ id: string; item_id: string; user_id: string | null; body: string; created_at: string }>(
    `SELECT id, item_id, user_id, body, created_at::text AS created_at
       FROM aaelink.list_item_comments
      WHERE item_id = $1
      ORDER BY created_at ASC`,
    [itemId]
  )
  return { ok: true, comments: rows.map(r => ({ ...r, created_at: Number(r.created_at) })) }
}

export type DeleteCommentResult =
  | { ok: true; commentId: string }
  | { ok: false; code: 'not_found' | 'forbidden' }

/** Delete a comment. The author or the list creator may delete it. */
export async function deleteItemComment(pool: Pool, uid: string, commentId: string): Promise<DeleteCommentResult> {
  const { rows } = await pool.query<{ author: string | null; list_creator: string }>(
    `SELECT cmt.user_id AS author, l.created_by AS list_creator
       FROM aaelink.list_item_comments cmt
       JOIN aaelink.lists l ON l.id = cmt.list_id
      WHERE cmt.id = $1`,
    [commentId]
  )
  const row = rows[0]
  if (!row) return { ok: false, code: 'not_found' }
  if (row.author !== uid && row.list_creator !== uid) return { ok: false, code: 'forbidden' }

  await pool.query(`DELETE FROM aaelink.list_item_comments WHERE id = $1`, [commentId])
  return { ok: true, commentId }
}
