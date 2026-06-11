import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import {
  resolveListWriteAccess, resolveItemWriteAccess,
  addColumn, updateColumn, deleteColumn,
} from '@/lib/knowledge/listAccess'
import { checkJsonBytes, MAX_LIST_VALUES_BYTES } from '@/lib/knowledge/canvasSections'
import { emitKnowledgeEvent } from '@/lib/knowledge/knowledgeRealtime'

/**
 * Coerce a JSONB column to a JS value. `pg` returns JSONB already parsed (object/
 * array), but legacy rows or some drivers can surface it as a string — handle
 * both. The previous `JSON.parse(String(x))` path silently returned the fallback
 * for native objects (String({...}) = "[object Object]"), dropping item values.
 */
function asJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback
  if (typeof raw === 'object') return raw as T
  if (typeof raw === 'string') {
    try { return JSON.parse(raw || '') as T } catch { return fallback }
  }
  return fallback
}

/** Emit a list.updated event, channel-scoped when the list is attached to one. */
async function emitListUpdated(listId: string, channelId: string, ownerId: string): Promise<void> {
  await emitKnowledgeEvent(
    { kind: 'list.updated', list_id: listId, channel_id: channelId },
    { channelId, ownerId }
  )
}

/**
 * Slack Lists API — structured data lists (spreadsheet-like) within channels.
 *
 * GET  /api/lists — list all lists or get a specific list
 * POST /api/lists — create/update/delete lists, items, and columns
 *
 * Read access (GET) and write access (every POST mutation) both run through
 * lib/knowledge/listAccess: a list is visible/writable to its creator or to
 * anyone who can read its channel; a standalone list is private to its creator.
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
    // A list is visible to its creator, or to anyone who can read its channel.
    const canRead = list.created_by === uid ||
      (Boolean(list.channel_id) && await userCanReadChannel(pool, uid, list.channel_id))
    if (!canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const { rows: items } = await pool.query<{
      id: string; list_id: string; values: string;
      position: number; created_by: string; created_at: number;
    }>(
      `SELECT * FROM aaelink.list_items WHERE list_id = $1 ORDER BY position ASC, created_at ASC`, [listId]
    )

    return NextResponse.json({
      list: {
        ...list,
        columns: asJson<unknown[]>(list.columns, []),
        items: items.map(item => ({
          ...item,
          values: asJson<Record<string, unknown>>(item.values, {}),
        })),
      },
    })
  }

  // List many lists. Scoped to a channel the user can read, otherwise only the
  // user's own lists — never an unfiltered dump of every workspace's lists.
  let query = `SELECT * FROM aaelink.lists WHERE 1=1`
  const params: unknown[] = []

  if (channelId) {
    if (!(await userCanReadChannel(pool, uid, channelId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    params.push(channelId)
    query += ` AND channel_id = $${params.length}`
  } else {
    params.push(uid)
    query += ` AND created_by = $${params.length}`
  }

  query += ` ORDER BY created_at DESC LIMIT 100`

  const { rows } = await pool.query<{
    id: string; name: string; description: string; columns: string;
    channel_id: string; view_type: string; created_by: string; created_at: number;
  }>(query, params)
  const lists = rows.map(r => ({
    ...r,
    columns: asJson<unknown[]>(r.columns, []),
  }))

  return NextResponse.json({ lists })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'create_list' | 'update_list' | 'delete_list' | 'add_item' | 'update_item' | 'delete_item' | 'add_column' | 'update_column' | 'delete_column'
    list_id?: string; channel_id?: string; name?: string; description?: string
    columns?: Array<{ name: string; type: string; options?: string[] }>
    view?: 'table' | 'board' | 'calendar'
    item_id?: string; values?: Record<string, unknown>; position?: number
    column_name?: string; column_type?: string; column_options?: string[]
    new_column_name?: string
  }

  const action = body.action || 'create_list'
  const now = Date.now()
  const ip = extractIp(req)

  if (action === 'create_list') {
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    // A channel-attached list may only be created by a channel reader.
    if (body.channel_id && !(await userCanReadChannel(pool, uid, body.channel_id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
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
    writeAuditLog({ pool, actorId: uid, action: 'list.create', resourceKind: 'list', resourceId: id, ipAddress: ip, metadata: { channel_id: body.channel_id || '' } })
    return NextResponse.json({ list: { id, name: body.name, columns: defaultColumns } }, { status: 201 })
  }

  // Item-keyed actions resolve write access via the item's list.
  if (action === 'update_item' || action === 'delete_item') {
    if (!body.item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })
    const access = await resolveItemWriteAccess(pool, uid, body.item_id)
    if (!access.exists) return NextResponse.json({ error: 'item_not_found' }, { status: 404 })
    if (!access.canWrite) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    if (action === 'delete_item') {
      await pool.query(`DELETE FROM aaelink.list_items WHERE id = $1`, [body.item_id])
      await emitKnowledgeEvent(
        { kind: 'list_item.deleted', list_id: access.listId, item_id: body.item_id, channel_id: access.channelId },
        { channelId: access.channelId, ownerId: access.ownerId }
      )
      return NextResponse.json({ ok: true })
    }
    if (body.values && !checkJsonBytes(body.values, MAX_LIST_VALUES_BYTES)) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
    }
    const updates: string[] = []
    const params: unknown[] = []
    if (body.values) { params.push(JSON.stringify(body.values)); updates.push(`values = $${params.length}`) }
    if (body.position !== undefined) { params.push(body.position); updates.push(`position = $${params.length}`) }
    if (updates.length > 0) {
      params.push(body.item_id)
      await pool.query(`UPDATE aaelink.list_items SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
    }
    await emitKnowledgeEvent(
      { kind: 'list_item.updated', list_id: access.listId, item_id: body.item_id, channel_id: access.channelId },
      { channelId: access.channelId, ownerId: access.ownerId }
    )
    return NextResponse.json({ ok: true })
  }

  // Every remaining action operates on an existing list and requires write access.
  if (!body.list_id) return NextResponse.json({ error: 'list_id required' }, { status: 400 })
  const access = await resolveListWriteAccess(pool, uid, body.list_id)
  if (!access.exists) return NextResponse.json({ error: 'list_not_found' }, { status: 404 })
  if (!access.canWrite) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const listId = body.list_id

  if (action === 'update_list') {
    const updates: string[] = []
    const params: unknown[] = []
    if (body.name) { params.push(body.name); updates.push(`name = $${params.length}`) }
    if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`) }
    if (body.columns) { params.push(JSON.stringify(body.columns)); updates.push(`columns = $${params.length}`) }
    if (body.view) { params.push(body.view); updates.push(`view_type = $${params.length}`) }
    if (updates.length > 0) {
      params.push(listId)
      await pool.query(`UPDATE aaelink.lists SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
    }
    await emitListUpdated(listId, access.channelId, access.ownerId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_list') {
    await pool.query(`DELETE FROM aaelink.list_items WHERE list_id = $1`, [listId])
    await pool.query(`DELETE FROM aaelink.lists WHERE id = $1`, [listId])
    writeAuditLog({ pool, actorId: uid, action: 'list.delete', resourceKind: 'list', resourceId: listId, ipAddress: ip })
    await emitListUpdated(listId, access.channelId, access.ownerId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_item') {
    if (body.values && !checkJsonBytes(body.values, MAX_LIST_VALUES_BYTES)) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
    }
    const id = randomUUID()
    const { rows: [maxPos] } = await pool.query<{ max: string }>(
      `SELECT COALESCE(MAX(position), 0)::text AS max FROM aaelink.list_items WHERE list_id = $1`, [listId]
    )
    const pos = body.position ?? (Number(maxPos?.max || 0) + 1)
    await pool.query(`
      INSERT INTO aaelink.list_items (id, list_id, values, position, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, listId, JSON.stringify(body.values || {}), pos, uid, now])
    await emitKnowledgeEvent(
      { kind: 'list_item.created', list_id: listId, item_id: id, channel_id: access.channelId },
      { channelId: access.channelId, ownerId: access.ownerId }
    )
    return NextResponse.json({ item: { id, list_id: listId, values: body.values, position: pos } }, { status: 201 })
  }

  if (action === 'add_column') {
    if (!body.column_name || !body.column_type) {
      return NextResponse.json({ error: 'column_name, column_type required' }, { status: 400 })
    }
    const cols = await addColumn(pool, listId, body.column_name, body.column_type, body.column_options || [])
    writeAuditLog({ pool, actorId: uid, action: 'list.column_add', resourceKind: 'list', resourceId: listId, ipAddress: ip, metadata: { column: body.column_name } })
    await emitListUpdated(listId, access.channelId, access.ownerId)
    return NextResponse.json({ ok: true, columns: cols })
  }

  if (action === 'update_column') {
    if (!body.column_name) return NextResponse.json({ error: 'column_name required' }, { status: 400 })
    const res = await updateColumn(pool, listId, body.column_name, {
      newName: body.new_column_name, type: body.column_type, options: body.column_options,
    })
    if (!res.ok) {
      return NextResponse.json({ error: res.code }, { status: res.code === 'column_exists' ? 409 : 404 })
    }
    writeAuditLog({ pool, actorId: uid, action: 'list.column_update', resourceKind: 'list', resourceId: listId, ipAddress: ip, metadata: { column: body.column_name, renamed_to: body.new_column_name } })
    await emitListUpdated(listId, access.channelId, access.ownerId)
    return NextResponse.json({ ok: true, columns: res.columns })
  }

  if (action === 'delete_column') {
    if (!body.column_name) return NextResponse.json({ error: 'column_name required' }, { status: 400 })
    const res = await deleteColumn(pool, listId, body.column_name)
    if (!res.ok) return NextResponse.json({ error: res.code }, { status: 404 })
    writeAuditLog({ pool, actorId: uid, action: 'list.column_delete', resourceKind: 'list', resourceId: listId, ipAddress: ip, metadata: { column: body.column_name } })
    await emitListUpdated(listId, access.channelId, access.ownerId)
    return NextResponse.json({ ok: true, columns: res.columns })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/lists', _GET)
export const POST   = tracedRoute('POST', '/api/lists', _POST)
