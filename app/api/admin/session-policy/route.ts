// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import {
  getSessionPolicy,
  updateSessionPolicy,
  validatePolicyPatch,
  type SessionPolicy,
} from '@/lib/auth/sessionPolicy'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Session Policy API — application-enforced session length and idle policy (D2).
 *
 * GET  /api/admin/session-policy — get the effective policy
 * PUT  /api/admin/session-policy — update the policy (admin only)
 *
 * The stored policy actually drives behavior: login stamps session TTL from it
 * and readSessionUserId enforces the idle timeout (lib/auth/sessionPolicy).
 */

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const policy = await getSessionPolicy(pool)
  return NextResponse.json({ policy })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<SessionPolicy>
  const violation = validatePolicyPatch(body)
  if (violation) {
    return NextResponse.json({ error: `${violation.field}_${violation.message}` }, { status: 400 })
  }

  const now = Date.now()
  const updated = await updateSessionPolicy(pool, body, now)

  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, meta, created_at)
    VALUES ($1, $2, 'session_policy_updated', 'system', $3, $4)
  `, [randomUUID(), uid, JSON.stringify({ changes: body }), now])

  return NextResponse.json({ policy: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/session-policy', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/session-policy', _PUT)
