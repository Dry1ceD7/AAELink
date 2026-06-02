import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Audit stream configuration management.
 *
 * GET    — list configs
 * POST   — create config
 * PATCH  — update config
 * DELETE — delete config
 */

type Destination = 'splunk' | 'elasticsearch' | 's3' | 'webhook' | 'syslog'
type Format = 'json' | 'cef' | 'leef'

const VALID_DESTINATIONS: Destination[] = ['splunk', 'elasticsearch', 's3', 'webhook', 'syslog']
const VALID_FORMATS: Format[] = ['json', 'cef', 'leef']

async function requireAdmin() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { uid, pool }
}

async function _GET(_req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { rows } = await auth.pool.query(
    `SELECT * FROM aaelink.audit_stream_configs ORDER BY created_at DESC`
  )
  return NextResponse.json({ configs: rows })
}

async function _POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    workspace_id?: string; destination?: Destination; endpoint_url?: string
    auth_token?: string; format?: Format; enabled?: boolean
  }

  if (!body.workspace_id || !body.destination || !body.endpoint_url) {
    return NextResponse.json({ error: 'workspace_id_destination_endpoint_required' }, { status: 400 })
  }
  if (!VALID_DESTINATIONS.includes(body.destination)) {
    return NextResponse.json({ error: 'invalid_destination' }, { status: 400 })
  }

  const fmt = body.format ?? 'json'
  if (!VALID_FORMATS.includes(fmt)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 })
  }

  const { rows } = await auth.pool.query(
    `INSERT INTO aaelink.audit_stream_configs
       (workspace_id, destination, endpoint_url, auth_token, format, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [body.workspace_id, body.destination, body.endpoint_url, body.auth_token ?? null, fmt, body.enabled ?? true]
  )
  return NextResponse.json({ config: rows[0] }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    id?: string; endpoint_url?: string; auth_token?: string
    format?: Format; enabled?: boolean
  }
  if (!body.id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1

  if (body.endpoint_url !== undefined) { sets.push(`endpoint_url = $${idx++}`); vals.push(body.endpoint_url) }
  if (body.auth_token !== undefined)   { sets.push(`auth_token = $${idx++}`);   vals.push(body.auth_token) }
  if (body.format !== undefined)       { sets.push(`format = $${idx++}`);       vals.push(body.format) }
  if (body.enabled !== undefined)      { sets.push(`enabled = $${idx++}`);      vals.push(body.enabled) }

  if (sets.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  vals.push(body.id)
  const { rows } = await auth.pool.query(
    `UPDATE aaelink.audit_stream_configs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ config: rows[0] })
}

async function _DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as { id?: string }
  if (!body.id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const res = await auth.pool.query(
    `DELETE FROM aaelink.audit_stream_configs WHERE id = $1`, [body.id]
  )
  if ((res.rowCount ?? 0) === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/audit-streams', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/audit-streams', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/audit-streams', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/audit-streams', _DELETE)
