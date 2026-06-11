import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'

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

  // Write the legacy flat address columns and the canonical JSONB blob in
  // one shot. The JSONB form is what the Puzzle Box pipeline reads.
  const addressJson = {
    line1: String(body.address_line1 || '').trim() || undefined,
    line2: String(body.address_line2 || '').trim() || undefined,
    city: String(body.city || '').trim() || undefined,
    state: String(body.state || '').trim() || undefined,
    postal_code: String(body.postal_code || '').trim() || undefined,
    country: String(body.country || '').trim() || undefined,
  }

  await pool.query(
    `INSERT INTO aaelink.client_profiles
      (id, workspace_id, name, code, address_line1, address_line2, city, state, postal_code, country,
       phone, email, website, legal_boilerplate, tax_id, metadata, address, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
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
      JSON.stringify(addressJson),
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
    id?: string
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

  // Accept both `id` (legacy ClientsPanel) and `client_id` (newer callers)
  const clientId = String(body.client_id || body.id || '').trim()
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

  // Whenever any address field is updated, also rewrite the JSONB `address`
  // blob the Puzzle Box pipeline reads from. Idempotent.
  const addressFieldNames = ['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country'] as const
  if (addressFieldNames.some(f => body[f] !== undefined)) {
    const addressJson = {
      line1: body.address_line1 !== undefined ? String(body.address_line1).trim() || undefined : undefined,
      line2: body.address_line2 !== undefined ? String(body.address_line2).trim() || undefined : undefined,
      city: body.city !== undefined ? String(body.city).trim() || undefined : undefined,
      state: body.state !== undefined ? String(body.state).trim() || undefined : undefined,
      postal_code: body.postal_code !== undefined ? String(body.postal_code).trim() || undefined : undefined,
      country: body.country !== undefined ? String(body.country).trim() || undefined : undefined,
    }
    // Merge with existing JSONB to preserve fields that weren't part of this PATCH
    const { rows: cur } = await pool.query<{ address: Record<string, string> | string }>(
      `SELECT address FROM aaelink.client_profiles WHERE id = $1`, [clientId]
    )
    const existing = cur[0]?.address
    const existingObj = typeof existing === 'string' ? JSON.parse(existing || '{}') : (existing || {})
    const merged = { ...existingObj, ...Object.fromEntries(Object.entries(addressJson).filter(([, v]) => v !== undefined)) }
    params.push(JSON.stringify(merged))
    updates.push(`address = $${params.length}`)
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

/** DELETE /api/clients — remove a client profile (workspace member). */
async function _DELETE(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as { id?: string; client_id?: string }
  const clientId = String(body.client_id || body.id || '').trim()
  if (!clientId) return NextResponse.json({ error: 'client_id_required' }, { status: 400 })

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.client_profiles WHERE id = $1`, [clientId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, rows[0].workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await pool.query(`DELETE FROM aaelink.client_profiles WHERE id = $1`, [clientId])
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/clients', _GET)
export const POST   = tracedRoute('POST', '/api/clients', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/clients', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/clients', _DELETE)
