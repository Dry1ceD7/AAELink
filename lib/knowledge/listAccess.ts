/**
 * Slack Lists — access resolution + column operations.
 *
 * Extracted from app/api/lists/route.ts to keep the route file under the
 * ~250-line budget. Access mirrors the list read model and the item-thread
 * model: a list is writable by its creator, or by anyone who can read its
 * attached channel; a standalone (channel-less) list is private to its creator.
 *
 * Column ops manipulate the list's `columns` JSON and keep item `values` in
 * sync (rename carries values to the new key; delete strips the key). All SQL
 * is parameterized.
 */
import type { Pool } from 'pg'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'

export interface ListWriteAccess {
  exists: boolean
  canWrite: boolean
  channelId: string
  ownerId: string
}

/** Resolve whether `uid` may mutate `listId`. */
export async function resolveListWriteAccess(
  pool: Pool, uid: string, listId: string
): Promise<ListWriteAccess> {
  const { rows } = await pool.query<{ created_by: string; channel_id: string }>(
    `SELECT created_by, channel_id FROM aaelink.lists WHERE id = $1`, [listId]
  )
  const row = rows[0]
  if (!row) return { exists: false, canWrite: false, channelId: '', ownerId: '' }
  const canWrite = row.created_by === uid ||
    (Boolean(row.channel_id) && await userCanReadChannel(pool, uid, row.channel_id))
  return { exists: true, canWrite, channelId: row.channel_id || '', ownerId: row.created_by || '' }
}

/** Resolve write access to the list that owns `itemId`. */
export async function resolveItemWriteAccess(
  pool: Pool, uid: string, itemId: string
): Promise<{ exists: boolean; canWrite: boolean; listId: string; channelId: string; ownerId: string }> {
  const { rows } = await pool.query<{ list_id: string; created_by: string; channel_id: string }>(
    `SELECT i.list_id, l.created_by, l.channel_id
       FROM aaelink.list_items i JOIN aaelink.lists l ON l.id = i.list_id
      WHERE i.id = $1`, [itemId]
  )
  const row = rows[0]
  if (!row) return { exists: false, canWrite: false, listId: '', channelId: '', ownerId: '' }
  const canWrite = row.created_by === uid ||
    (Boolean(row.channel_id) && await userCanReadChannel(pool, uid, row.channel_id))
  return { exists: true, canWrite, listId: row.list_id, channelId: row.channel_id || '', ownerId: row.created_by || '' }
}

type Column = Record<string, unknown>

/**
 * Read a list's columns. The `columns` JSONB comes back from `pg` as a native
 * JS array, but older rows / some drivers can surface it as a string — handle
 * both so we never silently drop the existing columns (which would clobber them
 * on the next write).
 */
async function loadColumns(pool: Pool, listId: string): Promise<Column[]> {
  const { rows } = await pool.query<{ columns: unknown }>(
    `SELECT columns FROM aaelink.lists WHERE id = $1`, [listId]
  )
  const raw = rows[0]?.columns
  if (Array.isArray(raw)) return raw as Column[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}

export type ColumnOpResult =
  | { ok: true; columns: Column[] }
  | { ok: false; code: 'column_not_found' | 'column_exists' }

/** Append a column to a list (assumes write access already checked). */
export async function addColumn(
  pool: Pool, listId: string, name: string, type: string, options: string[]
): Promise<Column[]> {
  const cols = await loadColumns(pool, listId)
  cols.push({ name, type, options: options || [] })
  await pool.query(`UPDATE aaelink.lists SET columns = $1 WHERE id = $2`, [JSON.stringify(cols), listId])
  return cols
}

/**
 * Update a column definition. Optionally renames it (carrying each item's value
 * across to the new key) and/or changes its type/options.
 */
export async function updateColumn(
  pool: Pool, listId: string,
  columnName: string,
  changes: { newName?: string; type?: string; options?: string[] }
): Promise<ColumnOpResult> {
  const cols = await loadColumns(pool, listId)
  const idx = cols.findIndex((c) => c.name === columnName)
  if (idx === -1) return { ok: false, code: 'column_not_found' }

  const renamed = changes.newName && changes.newName !== columnName ? String(changes.newName) : ''
  // Renaming onto an existing column would silently merge/overwrite its values.
  if (renamed && cols.some((c) => c.name === renamed)) {
    return { ok: false, code: 'column_exists' }
  }
  if (renamed) cols[idx].name = renamed
  if (changes.type !== undefined) cols[idx].type = changes.type
  if (changes.options !== undefined) cols[idx].options = changes.options
  await pool.query(`UPDATE aaelink.lists SET columns = $1 WHERE id = $2`, [JSON.stringify(cols), listId])

  // On rename, carry each item's value to the new key. Single jsonb rewrite per
  // affected row (scoped to rows that hold the old key) — a targeted UPDATE, not
  // a full-table scan. Use jsonb_exists() rather than the `?` operator: node-pg
  // treats a literal `?` in SQL as a placeholder and misparses it.
  if (renamed) {
    await pool.query(
      `UPDATE aaelink.list_items
          SET values = (values - $2::text) || jsonb_build_object($3::text, values -> $2::text)
        WHERE list_id = $1 AND jsonb_exists(values, $2::text)`,
      [listId, columnName, renamed]
    )
  }
  return { ok: true, columns: cols }
}

/**
 * Delete a column from a list and strip its value from every item row. A single
 * set-based UPDATE using the jsonb `-` operator (scoped to rows that hold the
 * key) rather than a per-row loop.
 */
export async function deleteColumn(
  pool: Pool, listId: string, columnName: string
): Promise<ColumnOpResult> {
  const cols = await loadColumns(pool, listId)
  const next = cols.filter((c) => c.name !== columnName)
  if (next.length === cols.length) return { ok: false, code: 'column_not_found' }

  await pool.query(`UPDATE aaelink.lists SET columns = $1 WHERE id = $2`, [JSON.stringify(next), listId])
  // jsonb_exists() rather than `?` — node-pg misparses a literal `?` as a placeholder.
  await pool.query(
    `UPDATE aaelink.list_items SET values = values - $2::text WHERE list_id = $1 AND jsonb_exists(values, $2::text)`,
    [listId, columnName]
  )
  return { ok: true, columns: next }
}
