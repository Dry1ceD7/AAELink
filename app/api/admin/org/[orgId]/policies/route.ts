import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  listOrgPolicies,
  setOrgPolicy,
  type PolicyType,
} from '@/lib/enterprise/orgPolicies'

/**
 * GET  /api/admin/org/[orgId]/policies — list org policies
 * POST /api/admin/org/[orgId]/policies — set/update policy
 */

type Ctx = { params: Promise<{ orgId: string }> }

const VALID_TYPES: PolicyType[] = ['retention', 'dlp', 'sso', 'session', 'ip_access', 'data_residency']

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
  return null
}

async function _GET(_req: NextRequest, ctx: Ctx) {
  const fail = await requireAdmin()
  if (fail) return fail

  const { orgId } = await ctx.params
  const policies = await listOrgPolicies(orgId)
  return NextResponse.json({ policies })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const fail = await requireAdmin()
  if (fail) return fail

  const { orgId } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    policy_type?: PolicyType
    config?: Record<string, unknown>
    enforced?: boolean
  }

  if (!body.policy_type || !VALID_TYPES.includes(body.policy_type)) {
    return NextResponse.json({ error: 'invalid_policy_type', valid_types: VALID_TYPES }, { status: 400 })
  }

  const policy = await setOrgPolicy(
    orgId,
    body.policy_type,
    body.config ?? {},
    body.enforced ?? false
  )
  if (!policy) return NextResponse.json({ error: 'set_failed' }, { status: 500 })
  return NextResponse.json({ policy }, { status: 201 })
}

export const GET  = tracedRoute('GET',  '/api/admin/org/[orgId]/policies', _GET)
export const POST = tracedRoute('POST', '/api/admin/org/[orgId]/policies', _POST)
