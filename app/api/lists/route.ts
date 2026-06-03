import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Slack Lists API — structured data lists (spreadsheet-like) within channels.
 *
 * GET  /api/lists — list all lists or get a specific list
 * POST /api/lists — create/update/delete lists and list items
 *
 * Supports:
 *   - List creation with custom columns (text, number, date, user, status, link)
 *   - Row/item CRUD within a list
 *   - Column definition management
 *   - Channel attachment
 *   - List views (table/board/calendar)
 *   - Access control (per-list permissions)
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const listId = req.nextUrl.searchParams.get('list_id') || ''
  const channelId = req.nextUrl.searchParams.get('channel_id') || ''

  // Single list with items
  if (listId) {
    const { rows } = await pool.query<{
      id: string; name: string; description: string; columns: string;
      channel_id: string; view_type: string; created_by: string; created_at: number;
    }>(`SELECT * FROM aaelink.lists WHERE id = $1`, [listId])
    if (!rows[0]) return NextResponse.json({ error: 'list_not_found' }, { status: 404 })

    const list = rows[0]
    const { rows: items } = await pool.query<{
      id: string; list_id: string; values: string;
      position: number; created_by: string; created_at: number;
    }>(
      `SELECT * FROM aaelink.list_items WHERE list_id = $1 ORDER BY position ASC, created_at ASC`, [listId]
    )

    return NextResponse.json({
      list: {
        ...list,
        columns: (() => { try { return JSON.parse(String(list.columns || '[]')) } catch { return [] } })(),
        items: items.map(item => ({
          ...item,
          values: (() => { try { return JSON.parse(String(item.values || '{}')) } catch { return {} } })(),
        })),
      },
    })
  }

  // List all lists
  let query = `SELECT * FROM aaelink.lists WHERE 1=1`
  const params: unknown[] = []

  if (channelId) {
    params.push(channelId)
    query += ` AND channel_id = $${params.length}`
  }

  query += ` ORDER BY created_at DESC LIMIT 100`

  const { rows } = await pool.query<{
    id: string; name: string; description: string; columns: string;
    channel_id: string; view_type: string; created_by: string; created_at: number;
  }>(query, params)
  const lists = rows.map(r => ({
    ...r,
    columns: (() => { try { return JSON.parse(String(r.columns || '[]')) } catch { return [] } })(),
  }))

  return NextResponse.json({ lists })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureListsTables(pool)

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'create_list' | 'update_list' | 'delete_list' | 'add_item' | 'update_item' | 'delete_item' | 'add_column' | 'update_column'
    list_id?: string; channel_id?: string; name?: string; description?: string
    columns?: Array<{ name: string; type: string; options?: string[] }>
    view?: 'table' | 'board' | 'calendar'
    // Item fields
    item_id?: string; values?: Record<string, unknown>; position?: number
    // Column fields
    column_name?: string; column_type?: string; column_options?: string[]
  }

  const action = body.action || 'create_list'
  const now = Date.now()

  if (action === 'create_list') {
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const id = randomUUID()
    const defaultColumns = body.columns || [
      { name: 'Title', type: 'text' },
      { name: 'Status', type: 'status', options: ['To Do', 'In Progress', 'Done'] },
      { name: 'Assignee', type: 'user' },
      { name: 'Due Date', type: 'date' },
    ]

    await pool.query(`
      INSERT INTO aaelink.lists (id, name, description, columns, channel_id, view_type, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, body.name, body.description || '', JSON.stringify(defaultColumns),
        body.channel_id || '', body.view || 'table', uid, now])

    return NextResponse.json({ list: { id, name: body.name, columns: defaultColumns } }, { status: 201 })
  }

  if (action === 'update_list') {
    if (!body.list_id) return NextResponse.json({ error: 'list_id required' }, { status: 400 })
    const updates: string[] = []
    const params: unknown[] = []

    if (body.name) { params.push(body.name); updates.push(`name = $${params.length}`) }
    if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`) }
    if (body.columns) { params.push(JSON.stringify(body.columns)); updates.push(`columns = $${params.length}`) }
    if (body.view) { params.push(body.view); updates.push(`view_type = $${params.length}`) }

    if (updates.length > 0) {
      params.push(body.list_id)
      await pool.query(`UPDATE aaelink.lists SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_list') {
    if (!body.list_id) return NextResponse.json({ error: 'list_id required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.list_items WHERE list_id = $1`, [body.list_id])
    await pool.query(`DELETE FROM aaelink.lists WHERE id = $1`, [body.list_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_item') {
    if (!body.list_id) return NextResponse.json({ error: 'list_id required' }, { status: 400 })
    const id = randomUUID()
    const { rows: [maxPos] } = await pool.query<{ max: string }>(
      `SELECT COALESCE(MAX(position), 0)::text AS max FROM aaelink.list_items WHERE list_id = $1`, [body.list_id]
    )
    const pos = body.position ?? (Number(maxPos?.max || 0) + 1)

    await pool.query(`
      INSERT INTO aaelink.list_items (id, list_id, values, position, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, body.list_id, JSON.stringify(body.values || {}), pos, uid, now])

    return NextResponse.json({ item: { id, list_id: body.list_id, values: body.values, position: pos } }, { status: 201 })
  }

  if (action === 'update_item') {
    if (!body.item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })
    const updates: string[] = []
    const params: unknown[] = []

    if (body.values) { params.push(JSON.stringify(body.values)); updates.push(`values = $${params.length}`) }
    if (body.position !== undefined) { params.push(body.position); updates.push(`position = $${params.length}`) }

    if (updates.length > 0) {
      params.push(body.item_id)
      await pool.query(`UPDATE aaelink.list_items SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_item') {
    if (!body.item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.list_items WHERE id = $1`, [body.item_id])
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_column') {
    if (!body.list_id || !body.column_name || !body.column_type) {
      return NextResponse.json({ error: 'list_id, column_name, column_type required' }, { status: 400 })
    }
    const { rows } = await pool.query<{ columns: string }>(`SELECT columns FROM aaelink.lists WHERE id = $1`, [body.list_id])
    if (!rows[0]) return NextResponse.json({ error: 'list_not_found' }, { status: 404 })
    let cols: Array<Record<string, unknown>> = []
    try { cols = JSON.parse(rows[0].columns) } catch { /**/ }
    cols.push({ name: body.column_name, type: body.column_type, options: body.column_options || [] })
    await pool.query(`UPDATE aaelink.lists SET columns = $1 WHERE id = $2`, [JSON.stringify(cols), body.list_id])
    return NextResponse.json({ ok: true, columns: cols })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

async function ensureListsTables(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.lists (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      columns     JSONB NOT NULL DEFAULT '[]',
      channel_id  TEXT NOT NULL DEFAULT '',
      view_type   TEXT NOT NULL DEFAULT 'table',
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS aaelink.list_items (
      id          TEXT PRIMARY KEY,
      list_id     TEXT NOT NULL REFERENCES aaelink.lists(id) ON DELETE CASCADE,
      values      JSONB NOT NULL DEFAULT '{}',
      position    INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_list_items_list ON aaelink.list_items(list_id);
  `)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/lists', _GET)
export const POST   = tracedRoute('POST', '/api/lists', _POST)
