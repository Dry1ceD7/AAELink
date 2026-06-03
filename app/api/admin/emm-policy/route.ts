import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getEmmPolicy, updateEmmPolicy, validateEmmPatch, type EmmPolicy } from '@/lib/enterprise/deviceManagement'

/**
 * EMM policy (D2) — enterprise mobility management device controls.
 *
 * GET /api/admin/emm-policy — get the effective EMM policy
 * PUT /api/admin/emm-policy — update it (admin only)
 *
 * Controls screen-lock requirement, trusted-device enforcement, and minimum
 * client version; clients read it to enforce device posture.
 */

async function requireAdmin(): Promise<string | NextResponse> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { rows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid])
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return uid
}

async function _GET() {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const policy = await getEmmPolicy(getPool()!)
  return NextResponse.json({ policy })
}

async function _PUT(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!

  const body = (await req.json().catch(() => ({}))) as Partial<EmmPolicy>
  const violation = validateEmmPatch(body)
  if (violation) {
    return NextResponse.json({ error: `${violation.field}_${violation.message}` }, { status: 400 })
  }

  const policy = await updateEmmPolicy(pool, body)
  await pool.query(
    `INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, meta, created_at)
     VALUES ($1, $2, 'emm_policy_updated', 'system', $3, $4)`,
    [randomUUID(), uid, JSON.stringify({ changes: body }), Date.now()]
  ).catch(() => { /* best-effort */ })

  return NextResponse.json({ policy })
}

export const GET = tracedRoute('GET', '/api/admin/emm-policy', _GET)
export const PUT = tracedRoute('PUT', '/api/admin/emm-policy', _PUT)
