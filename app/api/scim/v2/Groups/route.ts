/**
 * AAELink SCIM v2 Provisioning — Groups Endpoint
 *
 * RFC 7644 compliant SCIM 2.0 implementation for group provisioning.
 * Maps to the existing `aaelink.user_groups` and `aaelink.user_group_members` tables.
 *
 * Every operation is scoped to the org of the presented SCIM bearer token
 * (scim_connections.org_id). Cross-org group reads/writes resolve to 404.
 *
 * Supported operations:
 *   GET    /api/scim/v2/Groups           — List/filter groups
 *   GET    /api/scim/v2/Groups/:id       — Get single group
 *   POST   /api/scim/v2/Groups           — Create group
 *   PUT    /api/scim/v2/Groups/:id       — Replace group
 *   PATCH  /api/scim/v2/Groups/:id       — Partial update (add/remove members)
 *   DELETE /api/scim/v2/Groups/:id       — Delete group
 */

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'

// ── SCIM Types ──────────────────────────────────────────────────────

const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'

interface ScimGroupMember {
  value: string
  display?: string
}

interface ScimGroup {
  schemas: string[]
  id: string
  displayName: string
  members?: ScimGroupMember[]
  meta?: { resourceType: string; created?: string; lastModified?: string }
}

interface ScimConnection {
  id: string
  /** Org this connection provisions into, or null for a legacy global connection. */
  org_id: string | null
}

function scimError(detail: string, status: number): Response {
  return NextResponse.json(
    { schemas: [SCIM_ERROR_SCHEMA], detail, status: String(status) },
    { status, headers: { 'Content-Type': 'application/scim+json' } }
  )
}

/**
 * Resolve the active SCIM connection for a request's bearer token, or null. The
 * connection carries the org all group operations are scoped to (org_id), so a
 * token of org A can never read or write org B's groups (cross-org → 404).
 */
async function resolveScimConnection(req: Request): Promise<ScimConnection | null> {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  if (!token) return null
  const pool = getPool()
  if (!pool) return null
  const crypto = await import('crypto')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const { rows } = await pool.query<{ id: string; org_id: string | null }>(
    `SELECT id, org_id::text AS org_id FROM aaelink.scim_connections
      WHERE bearer_token_hash = $1 AND is_active = true LIMIT 1`,
    [tokenHash]
  )
  return rows[0] ?? null
}

/** Build the org-scope SQL predicate + param for a connection. */
function orgScope(conn: ScimConnection, nextIdx: number): { sql: string; param?: unknown } {
  if (conn.org_id) return { sql: ` AND org_id = $${nextIdx}`, param: conn.org_id }
  // Global (org_id NULL) connection only sees legacy unscoped groups.
  return { sql: ` AND org_id IS NULL` }
}

/** Load a group, scoped to the connection's org. Cross-org → null (→ 404). */
async function loadGroup(groupId: string, conn: ScimConnection): Promise<ScimGroup | null> {
  const pool = getPool()
  if (!pool) return null

  const scope = orgScope(conn, 2)
  const params: unknown[] = [groupId]
  if (scope.param !== undefined) params.push(scope.param)
  const { rows } = await pool.query<{ id: string; name: string; created_at: string }>(
    `SELECT id, name, created_at FROM aaelink.user_groups WHERE id = $1${scope.sql}`,
    params
  )
  if (!rows[0]) return null
  const g = rows[0]

  const { rows: members } = await pool.query<{ user_id: string; username: string }>(
    `SELECT m.user_id, u.username FROM aaelink.user_group_members m
     LEFT JOIN aaelink.users u ON u.id = m.user_id
     WHERE m.group_id = $1
     ORDER BY m.added_at ASC`,
    [groupId]
  )

  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: g.id,
    displayName: g.name,
    members: members.map(m => ({ value: m.user_id, display: m.username || '' })),
    meta: { resourceType: 'Group', created: new Date(Number(g.created_at)).toISOString() },
  }
}

function audit(req: Request, conn: ScimConnection, action: string, groupId: string, metadata: Record<string, unknown> = {}): void {
  const pool = getPool()
  if (!pool) return
  writeAuditLog({
    pool, actorId: `scim:${conn.id}`, actorRole: 'scim',
    action, resourceKind: 'user_group', resourceId: groupId,
    ipAddress: extractIp(req),
    metadata: { ...metadata, org_id: conn.org_id },
  })
}

// ── Route Handlers ──────────────────────────────────────────────────

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  const conn = await resolveScimConnection(req)
  if (!conn) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)

  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (pathMatch) {
    const group = await loadGroup(pathMatch[1], conn)
    if (!group) return scimError('Group not found', 404)
    return NextResponse.json(group, { headers: { 'Content-Type': 'application/scim+json' } })
  }

  const filter = url.searchParams.get('filter') || ''
  const startIndex = Math.max(1, Number(url.searchParams.get('startIndex')) || 1)
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get('count')) || 100))

  const scope = orgScope(conn, 1)
  const params: unknown[] = []
  let whereClause = 'WHERE 1=1' + scope.sql
  if (scope.param !== undefined) params.push(scope.param)
  let paramIdx = params.length

  if (filter) {
    const match = filter.match(/^displayName\s+(eq|co|sw)\s+"([^"]*)"$/i)
    if (match) {
      paramIdx++
      const op = match[1].toLowerCase()
      if (op === 'eq') { whereClause += ` AND lower(name) = lower($${paramIdx})`; params.push(match[2]) }
      else if (op === 'co') { whereClause += ` AND lower(name) LIKE '%' || lower($${paramIdx}) || '%'`; params.push(match[2]) }
      else if (op === 'sw') { whereClause += ` AND lower(name) LIKE lower($${paramIdx}) || '%'`; params.push(match[2]) }
    }
  }

  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM aaelink.user_groups ${whereClause}`, params
  )
  const totalResults = Number(countResult.rows[0]?.total) || 0

  const offset = startIndex - 1
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.user_groups ${whereClause} ORDER BY created_at ASC LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
    [...params, count, offset]
  )

  const groups: ScimGroup[] = []
  for (const r of rows) {
    const g = await loadGroup(r.id, conn)
    if (g) groups.push(g)
  }

  return NextResponse.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: groups.length,
    Resources: groups,
  }, { headers: { 'Content-Type': 'application/scim+json' } })
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  const conn = await resolveScimConnection(req)
  if (!conn) return scimError('Unauthorized', 401)
  await ensureSchema()

  const body = (await req.json()) as { displayName?: string; members?: ScimGroupMember[]; externalId?: string }
  if (!body.displayName) return scimError('displayName is required', 400)

  const id = randomUUID()
  const now = Date.now()
  const handle = body.displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)

  await pool.query(
    `INSERT INTO aaelink.user_groups (id, name, handle, description, is_active, created_by, created_at, org_id) VALUES ($1, $2, $3, '', true, 'scim', $4, $5)`,
    [id, body.displayName, handle, now, conn.org_id]
  )

  if (body.members?.length) {
    for (const m of body.members) {
      await pool.query(
        `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, m.value, now]
      ).catch(() => {})
    }
  }

  audit(req, conn, 'scim.group.create', id, { displayName: body.displayName, memberCount: body.members?.length ?? 0 })

  const group = await loadGroup(id, conn)
  return NextResponse.json(group, {
    status: 201,
    headers: { 'Content-Type': 'application/scim+json', 'Location': `/api/scim/v2/Groups/${id}` },
  })
}

/** Resolve a group id scoped to the connection's org, or null (→ 404). */
async function scopedGroupId(groupId: string, conn: ScimConnection): Promise<string | null> {
  const pool = getPool()
  if (!pool) return null
  const scope = orgScope(conn, 2)
  const params: unknown[] = [groupId]
  if (scope.param !== undefined) params.push(scope.param)
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.user_groups WHERE id = $1${scope.sql}`, params
  )
  return rows[0]?.id ?? null
}

async function _PUT(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  const conn = await resolveScimConnection(req)
  if (!conn) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (!pathMatch) return scimError('Group ID required in path', 400)
  const groupId = await scopedGroupId(pathMatch[1], conn)
  if (!groupId) return scimError('Group not found', 404)

  const body = (await req.json()) as { displayName?: string; members?: ScimGroupMember[] }
  const now = Date.now()

  if (body.displayName) {
    const handle = body.displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)
    await pool.query(`UPDATE aaelink.user_groups SET name = $1, handle = $2 WHERE id = $3`, [body.displayName, handle, groupId])
  }

  if (body.members !== undefined) {
    await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [groupId])
    for (const m of body.members || []) {
      await pool.query(
        `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [groupId, m.value, now]
      ).catch(() => {})
    }
  }

  audit(req, conn, 'scim.group.replace', groupId, { displayName: body.displayName })

  const group = await loadGroup(groupId, conn)
  return NextResponse.json(group, { headers: { 'Content-Type': 'application/scim+json' } })
}

async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  const conn = await resolveScimConnection(req)
  if (!conn) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (!pathMatch) return scimError('Group ID required in path', 400)
  const groupId = await scopedGroupId(pathMatch[1], conn)
  if (!groupId) return scimError('Group not found', 404)

  const body = (await req.json()) as {
    schemas?: string[]
    Operations?: Array<{ op: string; path?: string; value?: unknown }>
  }

  const now = Date.now()

  for (const op of body.Operations || []) {
    const operation = op.op.toLowerCase()

    if (operation === 'replace' && op.path === 'displayName' && typeof op.value === 'string') {
      const handle = op.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)
      await pool.query(`UPDATE aaelink.user_groups SET name = $1, handle = $2 WHERE id = $3`, [op.value, handle, groupId])
    }

    if (operation === 'add' && op.path === 'members' && Array.isArray(op.value)) {
      for (const m of op.value as ScimGroupMember[]) {
        await pool.query(
          `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [groupId, m.value, now]
        ).catch(() => {})
      }
    }

    if (operation === 'remove' && op.path?.startsWith('members[')) {
      const valueMatch = op.path.match(/members\[value eq "([^"]+)"\]/)
      if (valueMatch) {
        await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, valueMatch[1]])
      }
    }

    if (operation === 'replace' && op.path === 'members' && Array.isArray(op.value)) {
      await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [groupId])
      for (const m of op.value as ScimGroupMember[]) {
        await pool.query(
          `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [groupId, m.value, now]
        ).catch(() => {})
      }
    }
  }

  audit(req, conn, 'scim.group.patch', groupId, { ops: (body.Operations || []).map(o => o.op) })

  const group = await loadGroup(groupId, conn)
  return NextResponse.json(group, { headers: { 'Content-Type': 'application/scim+json' } })
}

async function _DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  const conn = await resolveScimConnection(req)
  if (!conn) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (!pathMatch) return scimError('Group ID required in path', 400)
  const groupId = await scopedGroupId(pathMatch[1], conn)
  if (!groupId) return scimError('Group not found', 404)

  await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [groupId])
  await pool.query(`DELETE FROM aaelink.user_groups WHERE id = $1`, [groupId])

  audit(req, conn, 'scim.group.delete', groupId)

  return new Response(null, { status: 204 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/scim/v2/Groups', _GET)
export const POST   = tracedRoute('POST',   '/api/scim/v2/Groups', _POST)
export const PUT    = tracedRoute('PUT',    '/api/scim/v2/Groups', _PUT)
export const PATCH  = tracedRoute('PATCH',  '/api/scim/v2/Groups', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/scim/v2/Groups', _DELETE)
