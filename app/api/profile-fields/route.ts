import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getUserProfile, setUserValue } from '@/lib/enterprise/customProfileFields'

/**
 * User custom profile values (D11).
 *
 * GET /api/profile-fields?org_id=  — the caller's profile (every org field + value)
 * PUT /api/profile-fields          — set one value  Body: { org_id, field_id, value }
 *
 * Self-service: the caller reads/writes only their own values.
 */
const ERR: Record<string, number> = { field_not_found: 404, invalid_option: 400 }

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const orgId = (req.nextUrl.searchParams.get('org_id') || '').trim()
  if (!orgId) return NextResponse.json({ error: 'org_id_required' }, { status: 400 })

  const profile = await getUserProfile(pool, orgId, uid)
  return NextResponse.json({ profile })
}

async function _PUT(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { org_id?: string; field_id?: string; value?: string }
  const orgId = String(body.org_id || '').trim()
  const fieldId = String(body.field_id || '').trim()
  if (!orgId || !fieldId) return NextResponse.json({ error: 'org_id_and_field_id_required' }, { status: 400 })

  const result = await setUserValue(pool, orgId, uid, fieldId, String(body.value ?? ''))
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR[result.code] ?? 400 })
  return NextResponse.json({ ok: true, field_id: result.fieldId, value: result.value })
}

export const GET = tracedRoute('GET', '/api/profile-fields', _GET)
export const PUT = tracedRoute('PUT', '/api/profile-fields', _PUT)
