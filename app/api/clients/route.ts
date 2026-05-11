import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/clients — list client profiles for a workspace.
 * POST /api/clients — create a new client profile.
 */

async function _GET(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const search = req.nextUrl.searchParams.get('q')?.trim() || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)

  const where = ['workspace_id = $1']
  const params: (string | number)[] = [workspaceId]

  if (search) {
    params.push(`%${search}%`)
    where.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length} OR email ILIKE $${params.length})`)
  }

  const whereClause = where.join(' AND ')

  const { rows: cntRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.client_profiles WHERE ${whereClause}`, params
  )
  const total = Number(cntRows[0]?.cnt || 0)

  params.push(limit, offset)
  const { rows } = await pool.query<{
    id: string; workspace_id: string; name: string; code: string;
    address_line1: string; address_line2: string; city: string; state: string;
    postal_code: string; country: string; phone: string; email: string;
    website: string; legal_boilerplate: string; tax_id: string;
    metadata: string; created_by: string; created_at: number; updated_at: number;
    logo_url: string; logo_key: string;
  }>(
    `SELECT * FROM aaelink.client_profiles WHERE ${whereClause}
     ORDER BY name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )

  const clients = rows.map(r => ({ ...r, created_at: Number(r.created_at), updated_at: Number(r.updated_at) }))

  return NextResponse.json({ clients, total, limit, offset, has_more: offset + clients.length < total })
}

async function _POST(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    workspace_id?: string
    name?: string
    code?: string
    address_line1?: string
    address_line2?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
    phone?: string
    email?: string
    website?: string
    legal_boilerplate?: string
    tax_id?: string
    metadata?: Record<string, unknown>
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const now = Date.now()
  const id = randomUUID()

  await pool.query(
    `INSERT INTO aaelink.client_profiles
      (id, workspace_id, name, code, address_line1, address_line2, city, state, postal_code, country,
       phone, email, website, legal_boilerplate, tax_id, metadata, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
    [
      id, workspaceId, name,
      String(body.code || '').trim(),
      String(body.address_line1 || '').trim(),
      String(body.address_line2 || '').trim(),
      String(body.city || '').trim(),
      String(body.state || '').trim(),
      String(body.postal_code || '').trim(),
      String(body.country || '').trim(),
      String(body.phone || '').trim(),
      String(body.email || '').trim(),
      String(body.website || '').trim(),
      String(body.legal_boilerplate || '').trim(),
      String(body.tax_id || '').trim(),
      JSON.stringify(body.metadata || {}),
      uid, now
    ]
  )

  return NextResponse.json({
    client: { id, workspace_id: workspaceId, name, created_at: now, updated_at: now }
  })
}

/** PATCH /api/clients — update client profile fields. */
async function _PATCH(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    client_id?: string
    name?: string
    code?: string
    address_line1?: string
    address_line2?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
    phone?: string
    email?: string
    website?: string
    legal_boilerplate?: string
    tax_id?: string
    logo_url?: string
    logo_key?: string
    metadata?: Record<string, unknown>
  }

  const clientId = String(body.client_id || '').trim()
  if (!clientId) return NextResponse.json({ error: 'client_id_required' }, { status: 400 })

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.client_profiles WHERE id = $1`, [clientId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, rows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = Date.now()
  const updates: string[] = ['updated_at = $2']
  const params: (string | number)[] = [clientId, now]

  const fields = ['name', 'code', 'address_line1', 'address_line2', 'city', 'state',
    'postal_code', 'country', 'phone', 'email', 'website', 'legal_boilerplate',
    'tax_id', 'logo_url', 'logo_key'] as const

  for (const f of fields) {
    if (body[f] !== undefined) {
      params.push(String(body[f]).trim())
      updates.push(`${f} = $${params.length}`)
    }
  }
  if (body.metadata !== undefined) {
    params.push(JSON.stringify(body.metadata))
    updates.push(`metadata = $${params.length}`)
  }

  await pool.query(
    `UPDATE aaelink.client_profiles SET ${updates.join(', ')} WHERE id = $1`,
    params
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/clients', _GET)
export const POST   = tracedRoute('POST', '/api/clients', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/clients', _PATCH)
