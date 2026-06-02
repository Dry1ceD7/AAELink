/**
 * AAELink SCIM v2 Provisioning — Groups Endpoint
 *
 * RFC 7644 compliant SCIM 2.0 implementation for group provisioning.
 * Maps to the existing `aaelink.user_groups` and `aaelink.user_group_members` tables.
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

function scimError(detail: string, status: number): Response {
  return NextResponse.json(
    { schemas: [SCIM_ERROR_SCHEMA], detail, status: String(status) },
    { status, headers: { 'Content-Type': 'application/scim+json' } }
  )
}

/** Validate SCIM bearer token */
async function validateScimToken(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  const token = auth.slice(7)
  if (!token) return false
  const pool = getPool()
  if (!pool) return false
  const crypto = await import('crypto')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.scim_connections WHERE bearer_token_hash = $1 AND is_active = true LIMIT 1`,
    [tokenHash]
  )
  return rows.length > 0
}

/** Load group with members */
async function loadGroup(groupId: string): Promise<ScimGroup | null> {
  const pool = getPool()
  if (!pool) return null

  const { rows } = await pool.query<{ id: string; name: string; handle: string; description: string; created_at: string }>(
    `SELECT id, name, handle, description, created_at FROM aaelink.user_groups WHERE id = $1`,
    [groupId]
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
    meta: {
      resourceType: 'Group',
      created: new Date(Number(g.created_at)).toISOString(),
    },
  }
}

// ── Route Handlers ──────────────────────────────────────────────────

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)

  // Single group
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (pathMatch) {
    const group = await loadGroup(pathMatch[1])
    if (!group) return scimError('Group not found', 404)
    return NextResponse.json(group, { headers: { 'Content-Type': 'application/scim+json' } })
  }

  // List groups with filter + pagination
  const filter = url.searchParams.get('filter') || ''
  const startIndex = Math.max(1, Number(url.searchParams.get('startIndex')) || 1)
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get('count')) || 100))

  let whereClause = 'WHERE 1=1'
  const params: unknown[] = []
  let paramIdx = 0

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
    const g = await loadGroup(r.id)
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
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const body = (await req.json()) as { displayName?: string; members?: ScimGroupMember[]; externalId?: string }
  if (!body.displayName) return scimError('displayName is required', 400)

  const id = randomUUID()
  const now = Date.now()
  const handle = body.displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)

  await pool.query(
    `INSERT INTO aaelink.user_groups (id, name, handle, description, is_active, created_by, created_at) VALUES ($1, $2, $3, '', true, 'scim', $4)`,
    [id, body.displayName, handle, now]
  )

  // Add members
  if (body.members?.length) {
    for (const m of body.members) {
      await pool.query(
        `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, m.value, now]
      ).catch(() => {})
    }
  }

  const group = await loadGroup(id)
  return NextResponse.json(group, {
    status: 201,
    headers: { 'Content-Type': 'application/scim+json', 'Location': `/api/scim/v2/Groups/${id}` },
  })
}

async function _PUT(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (!pathMatch) return scimError('Group ID required in path', 400)
  const groupId = pathMatch[1]

  const { rows: check } = await pool.query<{ id: string }>(`SELECT id FROM aaelink.user_groups WHERE id = $1`, [groupId])
  if (!check[0]) return scimError('Group not found', 404)

  const body = (await req.json()) as { displayName?: string; members?: ScimGroupMember[] }
  const now = Date.now()

  if (body.displayName) {
    const handle = body.displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)
    await pool.query(`UPDATE aaelink.user_groups SET name = $1, handle = $2 WHERE id = $3`, [body.displayName, handle, groupId])
  }

  // Replace membership entirely
  if (body.members !== undefined) {
    await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [groupId])
    for (const m of body.members || []) {
      await pool.query(
        `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [groupId, m.value, now]
      ).catch(() => {})
    }
  }

  const group = await loadGroup(groupId)
  return NextResponse.json(group, { headers: { 'Content-Type': 'application/scim+json' } })
}

async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (!pathMatch) return scimError('Group ID required in path', 400)
  const groupId = pathMatch[1]

  const { rows: check } = await pool.query<{ id: string }>(`SELECT id FROM aaelink.user_groups WHERE id = $1`, [groupId])
  if (!check[0]) return scimError('Group not found', 404)

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

    // Add members
    if (operation === 'add' && op.path === 'members' && Array.isArray(op.value)) {
      for (const m of op.value as ScimGroupMember[]) {
        await pool.query(
          `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [groupId, m.value, now]
        ).catch(() => {})
      }
    }

    // Remove members
    if (operation === 'remove' && op.path?.startsWith('members[')) {
      const valueMatch = op.path.match(/members\[value eq "([^"]+)"\]/)
      if (valueMatch) {
        await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, valueMatch[1]])
      }
    }

    // Replace members entirely
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

  const group = await loadGroup(groupId)
  return NextResponse.json(group, { headers: { 'Content-Type': 'application/scim+json' } })
}

async function _DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Groups\/([^/]+)$/)
  if (!pathMatch) return scimError('Group ID required in path', 400)
  const groupId = pathMatch[1]

  const { rows: check } = await pool.query<{ id: string }>(`SELECT id FROM aaelink.user_groups WHERE id = $1`, [groupId])
  if (!check[0]) return scimError('Group not found', 404)

  // Remove all members then delete group
  await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [groupId])
  await pool.query(`DELETE FROM aaelink.user_groups WHERE id = $1`, [groupId])

  return new Response(null, { status: 204 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/scim/v2/Groups', _GET)
export const POST   = tracedRoute('POST',   '/api/scim/v2/Groups', _POST)
export const PUT    = tracedRoute('PUT',    '/api/scim/v2/Groups', _PUT)
export const PATCH  = tracedRoute('PATCH',  '/api/scim/v2/Groups', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/scim/v2/Groups', _DELETE)
