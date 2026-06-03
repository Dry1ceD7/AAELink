import { NextRequest, NextResponse } from 'next/server'
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  claimDomain,
  verifyDomain,
  listOrgDomains,
  removeOrgDomain,
  type TxtResolver,
} from '@/lib/enterprise/domainClaiming'

/**
 * Domain claiming (D2).
 *
 * GET    /api/admin/org/[orgId]/domains — list the org's domain claims
 * POST   /api/admin/org/[orgId]/domains — claim a domain (returns TXT token)
 * PATCH  /api/admin/org/[orgId]/domains — verify a pending claim via DNS TXT
 * DELETE /api/admin/org/[orgId]/domains — remove a claim
 */

type Ctx = { params: Promise<{ orgId: string }> }

/** node:dns resolveTxt returns string[][] (chunks per record); flatten to one string per record. */
const realResolver: TxtResolver = async (hostname) => {
  const records = await dnsResolveTxt(hostname)
  return records.map(chunks => chunks.join(''))
}

const CLAIM_ERROR_STATUS: Record<string, number> = {
  invalid_domain: 400,
  claimed_by_other_org: 409,
  already_claimed: 409,
  not_found: 404,
  already_verified: 409,
  txt_not_found: 422,
}

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

async function _GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard

  const pool = getPool()!
  const { orgId } = await ctx.params
  const domains = await listOrgDomains(pool, orgId)
  return NextResponse.json({ domains, total: domains.length })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard

  const pool = getPool()!
  const { orgId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { domain?: string }

  const result = await claimDomain(pool, orgId, String(body.domain || ''), uid)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: CLAIM_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'org.domain.claim',
    resourceKind: 'organization',
    resourceId: orgId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { domain: result.domain },
  })

  return NextResponse.json(
    { ok: true, domain: result.domain, verification_record: result.record },
    { status: 201 }
  )
}

async function _PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard

  const pool = getPool()!
  const { orgId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { domain?: string }
  const domain = String(body.domain || '').trim()
  if (!domain) return NextResponse.json({ error: 'domain_required' }, { status: 400 })

  const result = await verifyDomain(pool, orgId, domain, realResolver)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: CLAIM_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'org.domain.verify',
    resourceKind: 'organization',
    resourceId: orgId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { domain: result.domain },
  })

  return NextResponse.json({ ok: true, domain: result.domain, verified: true })
}

async function _DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard

  const pool = getPool()!
  const { orgId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { domain?: string }
  const domain = String(body.domain || '').trim()
  if (!domain) return NextResponse.json({ error: 'domain_required' }, { status: 400 })

  const ok = await removeOrgDomain(pool, orgId, domain)
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'org.domain.remove',
    resourceKind: 'organization',
    resourceId: orgId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { domain },
  })

  return NextResponse.json({ ok: true, removed: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/org/[orgId]/domains', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/org/[orgId]/domains', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/org/[orgId]/domains', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/org/[orgId]/domains', _DELETE)
