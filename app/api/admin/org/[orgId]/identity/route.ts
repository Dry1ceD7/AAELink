import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  getEnterpriseIdentity,
  listEnterpriseMembers,
  reconcileOrgMembership,
} from '@/lib/enterprise/enterpriseIdentity'

/**
 * Enterprise identity (D1).
 *
 * GET  /api/admin/org/[orgId]/identity            — list the true enterprise member set
 * GET  /api/admin/org/[orgId]/identity?user_id=X  — resolve one user's enterprise identity
 * POST /api/admin/org/[orgId]/identity            — reconcile org_members from workspace standing
 */

type Ctx = { params: Promise<{ orgId: string }> }

/** Returns the caller's uid on success, or a NextResponse to short-circuit. */
async function requireAdmin(): Promise<string | NextResponse> {
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
  return uid
}

async function _GET(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard

  const pool = getPool()!
  const { orgId } = await ctx.params
  const url = new URL(req.url)
  const userId = (url.searchParams.get('user_id') || '').trim()

  if (userId) {
    const identity = await getEnterpriseIdentity(pool, orgId, userId)
    if (!identity) return NextResponse.json({ error: 'not_in_org' }, { status: 404 })
    return NextResponse.json({ identity })
  }

  const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '100', 10), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)
  const members = await listEnterpriseMembers(pool, orgId, limit, offset)
  return NextResponse.json({ members, total: members.length })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard

  const pool = getPool()!
  const { orgId } = await ctx.params

  const added = await reconcileOrgMembership(pool, orgId)

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'org.identity.reconcile',
    resourceKind: 'organization',
    resourceId: orgId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { added },
  })

  return NextResponse.json({ ok: true, added })
}

export const GET  = tracedRoute('GET',  '/api/admin/org/[orgId]/identity', _GET)
export const POST = tracedRoute('POST', '/api/admin/org/[orgId]/identity', _POST)
