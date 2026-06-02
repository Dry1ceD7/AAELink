/**
 * AAELink SCIM v2 Provisioning — Users Endpoint
 *
 * RFC 7644 compliant SCIM 2.0 implementation for automated user provisioning
 * from identity providers (Azure AD, Okta, OneLogin, JumpCloud, etc.)
 *
 * Supported operations:
 *   GET    /api/scim/v2/Users           — List/filter users
 *   GET    /api/scim/v2/Users/:id       — Get single user
 *   POST   /api/scim/v2/Users           — Create user
 *   PUT    /api/scim/v2/Users/:id       — Replace user
 *   PATCH  /api/scim/v2/Users/:id       — Partial update (JSON Patch)
 *   DELETE /api/scim/v2/Users/:id       — Deactivate user
 */

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { hashPassword } from '@/lib/auth/password'
import { tracedRoute } from '@/lib/api/tracedRoute'

// ── SCIM Types ──────────────────────────────────────────────────────

interface ScimName {
  formatted?: string
  familyName?: string
  givenName?: string
}

interface ScimEmail {
  value: string
  type?: string
  primary?: boolean
}

interface ScimPhoneNumber {
  value: string
  type?: string
}

interface ScimUser {
  schemas: string[]
  id?: string
  externalId?: string
  userName: string
  name?: ScimName
  displayName?: string
  nickName?: string
  title?: string
  emails?: ScimEmail[]
  phoneNumbers?: ScimPhoneNumber[]
  active?: boolean
  timezone?: string
  photos?: Array<{ value: string; type?: string }>
}

interface ScimListResponse {
  schemas: string[]
  totalResults: number
  startIndex: number
  itemsPerPage: number
  Resources: ScimUser[]
}

interface ScimError {
  schemas: string[]
  detail: string
  status: string
}

const SCIM_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'

// ── Helpers ─────────────────────────────────────────────────────────

function scimError(detail: string, status: number): Response {
  const body: ScimError = {
    schemas: [SCIM_ERROR_SCHEMA],
    detail,
    status: String(status),
  }
  return NextResponse.json(body, {
    status,
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

interface DbUser {
  id: string; username: string; email: string;
  first_name: string; last_name: string; nickname: string;
  job_title: string; phone: string; timezone: string;
  avatar_url: string; scim_external_id: string; scim_active: boolean;
}

function dbUserToScim(row: DbUser): ScimUser {
  const emails: ScimEmail[] = []
  if (row.email) emails.push({ value: String(row.email), type: 'work', primary: true })

  const phoneNumbers: ScimPhoneNumber[] = []
  if (row.phone) phoneNumbers.push({ value: String(row.phone), type: 'work' })

  const photos: Array<{ value: string; type: string }> = []
  if (row.avatar_url) photos.push({ value: String(row.avatar_url), type: 'photo' })

  return {
    schemas: [SCIM_SCHEMA],
    id: String(row.id),
    externalId: row.scim_external_id ? String(row.scim_external_id) : undefined,
    userName: String(row.username),
    name: {
      givenName: String(row.first_name || ''),
      familyName: String(row.last_name || ''),
      formatted: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    },
    displayName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || String(row.nickname || row.username),
    nickName: row.nickname ? String(row.nickname) : undefined,
    title: row.job_title ? String(row.job_title) : undefined,
    emails,
    phoneNumbers,
    active: row.scim_active !== false,
    timezone: row.timezone ? String(row.timezone) : undefined,
    photos,
  }
}

/** Validate SCIM bearer token against hashed tokens in scim_connections */
async function validateScimToken(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  const token = auth.slice(7)
  if (!token) return false

  const pool = getPool()
  if (!pool) return false

  // Hash the incoming token and compare against stored hashes
  const crypto = await import('crypto')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.scim_connections WHERE bearer_token_hash = $1 AND is_active = true LIMIT 1`,
    [tokenHash]
  )
  return rows.length > 0
}

/** Parse SCIM filter string (basic: userName eq "value") */
function parseScimFilter(filter: string): { field: string; op: string; value: string } | null {
  const match = filter.match(/^(\w+)\s+(eq|co|sw)\s+"([^"]*)"$/i)
  if (!match) return null
  return { field: match[1], op: match[2].toLowerCase(), value: match[3] }
}

// ── Route Handlers ──────────────────────────────────────────────────

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)

  // Single user: /api/scim/v2/Users/{id}
  const pathMatch = url.pathname.match(/\/Users\/([^/]+)$/)
  if (pathMatch) {
    const userId = pathMatch[1]
    const { rows } = await pool.query(
      `SELECT id, username, email, first_name, last_name, nickname, job_title, phone, timezone, avatar_url, scim_external_id, scim_active
       FROM aaelink.users WHERE id = $1`,
      [userId]
    )
    if (!rows[0]) return scimError('User not found', 404)
    return NextResponse.json(dbUserToScim(rows[0]), {
      headers: { 'Content-Type': 'application/scim+json' },
    })
  }

  // List users with optional filter & pagination
  const filter = url.searchParams.get('filter') || ''
  const startIndex = Math.max(1, Number(url.searchParams.get('startIndex')) || 1)
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get('count')) || 100))

  let whereClause = 'WHERE 1=1'
  const params: unknown[] = []
  let paramIdx = 0

  if (filter) {
    const parsed = parseScimFilter(filter)
    if (parsed) {
      const colMap: Record<string, string> = {
        userName: 'username', email: 'email', externalId: 'scim_external_id',
        'name.familyName': 'last_name', 'name.givenName': 'first_name',
      }
      const col = colMap[parsed.field]
      if (col) {
        paramIdx++
        if (parsed.op === 'eq') {
          whereClause += ` AND lower(${col}) = lower($${paramIdx})`
          params.push(parsed.value)
        } else if (parsed.op === 'co') {
          whereClause += ` AND lower(${col}) LIKE '%' || lower($${paramIdx}) || '%'`
          params.push(parsed.value)
        } else if (parsed.op === 'sw') {
          whereClause += ` AND lower(${col}) LIKE lower($${paramIdx}) || '%'`
          params.push(parsed.value)
        }
      }
    }
  }

  // Get total count
  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM aaelink.users ${whereClause}`,
    params
  )
  const totalResults = Number(countResult.rows[0]?.total) || 0

  // Paginated results
  const offset = startIndex - 1
  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, job_title, phone, timezone, avatar_url, scim_external_id, scim_active
     FROM aaelink.users ${whereClause}
     ORDER BY created_at ASC
     LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
    [...params, count, offset]
  )

  const response: ScimListResponse = {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map(r => dbUserToScim(r)),
  }

  return NextResponse.json(response, {
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const body = (await req.json()) as ScimUser

  if (!body.userName) return scimError('userName is required', 400)

  const email = body.emails?.find(e => e.primary)?.value || body.emails?.[0]?.value || `${body.userName}@scim.local`
  const firstName = body.name?.givenName || ''
  const lastName = body.name?.familyName || ''
  const nickname = body.nickName || ''
  const jobTitle = body.title || ''
  const phone = body.phoneNumbers?.[0]?.value || ''
  const timezone = body.timezone || 'Asia/Bangkok'
  const avatarUrl = body.photos?.[0]?.value || ''
  const externalId = body.externalId || ''
  const active = body.active !== false

  // Check for existing user
  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.users WHERE lower(username) = lower($1) OR lower(email) = lower($2) LIMIT 1`,
    [body.userName, email]
  )
  if (existing.length > 0) return scimError('User already exists', 409)

  const id = randomUUID()
  const now = Date.now()
  // Generate a random password (SCIM users typically authenticate via SSO)
  const tempPassword = randomUUID()
  const passwordHash = hashPassword(tempPassword)

  await pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, first_name, last_name, nickname, job_title, phone, timezone, avatar_url, scim_external_id, scim_active, scim_last_sync, created_at, platform_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'member')`,
    [id, body.userName, email, passwordHash, firstName, lastName, nickname, jobTitle, phone, timezone, avatarUrl, externalId, active, now, now]
  )

  // Log SCIM sync
  await pool.query(
    `INSERT INTO aaelink.scim_sync_log (id, action, external_id, user_id, status, created_at) VALUES ($1, 'create', $2, $3, 'success', $4)`,
    [randomUUID(), externalId, id, now]
  ).catch(() => {})

  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, job_title, phone, timezone, avatar_url, scim_external_id, scim_active
     FROM aaelink.users WHERE id = $1`, [id]
  )

  return NextResponse.json(dbUserToScim(rows[0]), {
    status: 201,
    headers: { 'Content-Type': 'application/scim+json', 'Location': `/api/scim/v2/Users/${id}` },
  })
}

async function _PUT(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Users\/([^/]+)$/)
  if (!pathMatch) return scimError('User ID required in path', 400)
  const userId = pathMatch[1]

  const { rows: check } = await pool.query<{ id: string }>(`SELECT id FROM aaelink.users WHERE id = $1`, [userId])
  if (!check[0]) return scimError('User not found', 404)

  const body = (await req.json()) as ScimUser

  const email = body.emails?.find(e => e.primary)?.value || body.emails?.[0]?.value
  const firstName = body.name?.givenName || ''
  const lastName = body.name?.familyName || ''
  const nickname = body.nickName || ''
  const jobTitle = body.title || ''
  const phone = body.phoneNumbers?.[0]?.value || ''
  const timezone = body.timezone || ''
  const avatarUrl = body.photos?.[0]?.value || ''
  const externalId = body.externalId || ''
  const active = body.active !== false
  const now = Date.now()

  const updates: string[] = []
  const vals: unknown[] = []
  let idx = 0

  const set = (col: string, val: unknown) => { idx++; updates.push(`${col} = $${idx}`); vals.push(val) }

  if (body.userName) set('username', body.userName)
  if (email) set('email', email)
  set('first_name', firstName)
  set('last_name', lastName)
  set('nickname', nickname)
  set('job_title', jobTitle)
  set('phone', phone)
  if (timezone) set('timezone', timezone)
  set('avatar_url', avatarUrl)
  set('scim_external_id', externalId)
  set('scim_active', active)
  set('scim_last_sync', now)

  if (updates.length > 0) {
    idx++
    await pool.query(`UPDATE aaelink.users SET ${updates.join(', ')} WHERE id = $${idx}`, [...vals, userId])
  }

  // Log sync
  await pool.query(
    `INSERT INTO aaelink.scim_sync_log (id, action, external_id, user_id, status, created_at) VALUES ($1, 'replace', $2, $3, 'success', $4)`,
    [randomUUID(), externalId, userId, now]
  ).catch(() => {})

  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, job_title, phone, timezone, avatar_url, scim_external_id, scim_active
     FROM aaelink.users WHERE id = $1`, [userId]
  )

  return NextResponse.json(dbUserToScim(rows[0]), {
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Users\/([^/]+)$/)
  if (!pathMatch) return scimError('User ID required in path', 400)
  const userId = pathMatch[1]

  const { rows: check } = await pool.query<{ id: string }>(`SELECT id FROM aaelink.users WHERE id = $1`, [userId])
  if (!check[0]) return scimError('User not found', 404)

  const body = (await req.json()) as {
    schemas?: string[]
    Operations?: Array<{
      op: string
      path?: string
      value?: unknown
    }>
  }

  const now = Date.now()

  for (const op of body.Operations || []) {
    const operation = op.op.toLowerCase()

    if (operation === 'replace') {
      if (op.path === 'active' || (!op.path && typeof op.value === 'object' && op.value !== null && 'active' in op.value)) {
        const active = op.path === 'active' ? op.value : (op.value as { active: unknown }).active
        await pool.query(`UPDATE aaelink.users SET scim_active = $1, scim_last_sync = $2 WHERE id = $3`, [active, now, userId])
      } else if (op.path === 'userName' && typeof op.value === 'string') {
        await pool.query(`UPDATE aaelink.users SET username = $1, scim_last_sync = $2 WHERE id = $3`, [op.value, now, userId])
      } else if (op.path === 'name.givenName' && typeof op.value === 'string') {
        await pool.query(`UPDATE aaelink.users SET first_name = $1, scim_last_sync = $2 WHERE id = $3`, [op.value, now, userId])
      } else if (op.path === 'name.familyName' && typeof op.value === 'string') {
        await pool.query(`UPDATE aaelink.users SET last_name = $1, scim_last_sync = $2 WHERE id = $3`, [op.value, now, userId])
      } else if (op.path === 'title' && typeof op.value === 'string') {
        await pool.query(`UPDATE aaelink.users SET job_title = $1, scim_last_sync = $2 WHERE id = $3`, [op.value, now, userId])
      } else if (!op.path && typeof op.value === 'object' && op.value !== null) {
        // Bulk replace
        const v = op.value as { active?: unknown; userName?: unknown }
        if ('active' in v) await pool.query(`UPDATE aaelink.users SET scim_active = $1, scim_last_sync = $2 WHERE id = $3`, [v.active, now, userId])
        if ('userName' in v) await pool.query(`UPDATE aaelink.users SET username = $1, scim_last_sync = $2 WHERE id = $3`, [v.userName, now, userId])
      }
    }
  }

  // Log sync
  await pool.query(
    `INSERT INTO aaelink.scim_sync_log (id, action, external_id, user_id, status, created_at) VALUES ($1, 'patch', '', $2, 'success', $3)`,
    [randomUUID(), userId, now]
  ).catch(() => {})

  const { rows } = await pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, job_title, phone, timezone, avatar_url, scim_external_id, scim_active
     FROM aaelink.users WHERE id = $1`, [userId]
  )

  return NextResponse.json(dbUserToScim(rows[0]), {
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

async function _DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return scimError('Service unavailable', 503)
  if (!(await validateScimToken(req))) return scimError('Unauthorized', 401)
  await ensureSchema()

  const url = new URL(req.url)
  const pathMatch = url.pathname.match(/\/Users\/([^/]+)$/)
  if (!pathMatch) return scimError('User ID required in path', 400)
  const userId = pathMatch[1]

  const { rows: check } = await pool.query<{ id: string }>(`SELECT id FROM aaelink.users WHERE id = $1`, [userId])
  if (!check[0]) return scimError('User not found', 404)

  const now = Date.now()

  // SCIM DELETE = deactivate (soft delete), not hard delete
  await pool.query(
    `UPDATE aaelink.users SET scim_active = false, scim_last_sync = $1 WHERE id = $2`,
    [now, userId]
  )

  // Revoke all sessions
  await pool.query(`DELETE FROM aaelink.sessions WHERE user_id = $1`, [userId])

  // Log sync
  await pool.query(
    `INSERT INTO aaelink.scim_sync_log (id, action, external_id, user_id, status, created_at) VALUES ($1, 'deactivate', '', $2, 'success', $3)`,
    [randomUUID(), userId, now]
  ).catch(() => {})

  return new Response(null, { status: 204 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/scim/v2/Users', _GET)
export const POST   = tracedRoute('POST',   '/api/scim/v2/Users', _POST)
export const PUT    = tracedRoute('PUT',    '/api/scim/v2/Users', _PUT)
export const PATCH  = tracedRoute('PATCH',  '/api/scim/v2/Users', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/scim/v2/Users', _DELETE)
