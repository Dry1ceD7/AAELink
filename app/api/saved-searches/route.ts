import type { Pool } from 'pg'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Saved Searches — Slack-parity persisted search queries.
 *
 * GET    /api/saved-searches?workspace_id=…  → list current user's saved searches
 * POST   /api/saved-searches                 → create { workspace_id, name, query, filters? }
 * PATCH  /api/saved-searches                 → update { id, name?, query?, filters? }  (owner only)
 * DELETE /api/saved-searches                 → remove  { id }                          (owner only)
 *
 * Rows are scoped to (user_id, workspace_id); a user only ever sees / mutates
 * their own. Workspace membership is asserted on every verb.
 */

const NAME_MAX = 120
const QUERY_MAX = 1000

interface SavedSearchRow {
  id: string
  workspace_id: string
  name: string
  query: string
  filters: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

function serialize(r: SavedSearchRow) {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    query: r.query,
    filters: r.filters ?? {},
    created_at: Number(r.created_at) || 0,
    updated_at: Number(r.updated_at) || 0,
  }
}

async function assertWorkspaceMember(pool: Pool, uid: string, workspaceId: string) {
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  return rows.length > 0
}

const SELECT_COLS = `id, workspace_id, name, query, filters,
  (EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS created_at,
  (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint::text AS updated_at`

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const workspace_id = String(url.searchParams.get('workspace_id') || url.searchParams.get('team_id') || '')
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  await ensureSchema()
  if (!(await assertWorkspaceMember(pool, uid, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<SavedSearchRow>(
    `SELECT ${SELECT_COLS} FROM aaelink.saved_searches
     WHERE user_id = $1 AND workspace_id = $2
     ORDER BY updated_at DESC`,
    [uid, workspace_id]
  )
  return NextResponse.json({ saved_searches: rows.map(serialize) })
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  let body: { workspace_id?: string; team_id?: string; name?: string; query?: string; filters?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const workspace_id = String(body.workspace_id || body.team_id || '')
  const name = String(body.name || '').trim().slice(0, NAME_MAX)
  const query = String(body.query || '').trim().slice(0, QUERY_MAX)
  const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
    ? (body.filters as Record<string, unknown>)
    : {}

  if (!workspace_id || !name || !query) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  if (!(await assertWorkspaceMember(pool, uid, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<SavedSearchRow>(
    `INSERT INTO aaelink.saved_searches (workspace_id, user_id, name, query, filters)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING ${SELECT_COLS}`,
    [workspace_id, uid, name, query, JSON.stringify(filters)]
  )
  const saved = serialize(rows[0])

  writeAuditLog({
    pool, workspaceId: workspace_id, actorId: uid,
    action: 'saved_search.create', resourceKind: 'saved_search', resourceId: saved.id,
    ipAddress: extractIp(req), userAgent: req.headers.get('user-agent') || '',
    metadata: { name },
  })

  return NextResponse.json({ saved_search: saved }, { status: 201 })
}

async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  let body: { id?: string; name?: string; query?: string; filters?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const id = String(body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const sets: string[] = []
  const params: unknown[] = []
  let i = 1
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, NAME_MAX)
    if (!name) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    sets.push(`name = $${i++}`); params.push(name)
  }
  if (body.query !== undefined) {
    const query = String(body.query || '').trim().slice(0, QUERY_MAX)
    if (!query) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    sets.push(`query = $${i++}`); params.push(query)
  }
  if (body.filters !== undefined) {
    const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? (body.filters as Record<string, unknown>)
      : {}
    sets.push(`filters = $${i++}::jsonb`); params.push(JSON.stringify(filters))
  }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
  sets.push(`updated_at = now()`)

  // Owner-only: the WHERE clause restricts to the caller's own row.
  params.push(id, uid)
  const { rows } = await pool.query<SavedSearchRow>(
    `UPDATE aaelink.saved_searches SET ${sets.join(', ')}
     WHERE id = $${i++} AND user_id = $${i}
     RETURNING ${SELECT_COLS}`,
    params
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ saved_search: serialize(rows[0]) })
}

async function _DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  let body: { id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const id = String(body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Owner-only: only the row belonging to the caller is deleted.
  const { rows } = await pool.query<{ id: string; workspace_id: string }>(
    `DELETE FROM aaelink.saved_searches WHERE id = $1 AND user_id = $2
     RETURNING id, workspace_id`,
    [id, uid]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  writeAuditLog({
    pool, workspaceId: rows[0].workspace_id, actorId: uid,
    action: 'saved_search.delete', resourceKind: 'saved_search', resourceId: id,
    ipAddress: extractIp(req), userAgent: req.headers.get('user-agent') || '',
  })

  return NextResponse.json({ ok: true, deleted: id })
}

export const GET    = tracedRoute('GET',    '/api/saved-searches', _GET)
export const POST   = tracedRoute('POST',   '/api/saved-searches', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/saved-searches', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/saved-searches', _DELETE)
