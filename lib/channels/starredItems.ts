import type { Pool } from 'pg'

/**
 * Starred / saved item lifecycle.
 *
 * Users can star messages, channels, and files.
 * Stored in aaelink.saved_messages with item_type discriminator.
 */

export type StarItemType = 'message' | 'channel' | 'file'

export interface StarredItem {
  id: string
  user_id: string
  item_type: StarItemType
  item_id: string
  starred_at: number
}

export async function starItem(
  pool: Pool, userId: string, itemType: StarItemType, itemId: string
): Promise<void> {
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.saved_messages (user_id, item_type, item_id, starred_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
    [userId, itemType, itemId, now]
  )
}

export async function unstarItem(
  pool: Pool, userId: string, itemType: StarItemType, itemId: string
): Promise<void> {
  await pool.query(
    `DELETE FROM aaelink.saved_messages WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
    [userId, itemType, itemId]
  )
}

export async function listStarredItems(
  pool: Pool,
  userId: string,
  filters?: { itemType?: StarItemType; limit?: number; offset?: number }
): Promise<StarredItem[]> {
  let sql = `SELECT * FROM aaelink.saved_messages WHERE user_id = $1`
  const params: unknown[] = [userId]
  let idx = 2

  if (filters?.itemType) {
    sql += ` AND item_type = $${idx++}`
    params.push(filters.itemType)
  }

  sql += ` ORDER BY starred_at DESC`
  sql += ` LIMIT $${idx++}`
  params.push(filters?.limit ?? 100)
  sql += ` OFFSET $${idx++}`
  params.push(filters?.offset ?? 0)

  const { rows } = await pool.query(sql, params)
  return rows as StarredItem[]
}
