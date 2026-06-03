import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  setPartnerDomain,
  removePartnerDomain,
  listPartnerDomains,
  type PartnerStatus,
} from '@/lib/enterprise/connectAllowlist'

/**
 * Connect partner allowlist (D8).
 *
 * GET    /api/admin/org/[orgId]/connect-allowlist — list partner domains
 * POST   /api/admin/org/[orgId]/connect-allowlist — allow/block a domain
 *        Body: { domain, status? ('allowed'|'blocked') }
 * DELETE /api/admin/org/[orgId]/connect-allowlist — remove a domain Body: { domain }
 */
type Ctx = { params: Promise<{ orgId: string }> }

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

async function _GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const { orgId } = await ctx.params
  const partners = await listPartnerDomains(getPool()!, orgId)
  return NextResponse.json({ partners, total: partners.length })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!
  const { orgId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { domain?: string; status?: string }
  const status: PartnerStatus = body.status === 'blocked' ? 'blocked' : 'allowed'

  const result = await setPartnerDomain(pool, orgId, String(body.domain || ''), status, uid)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 })

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'connect.partner.set',
    resourceKind: 'organization',
    resourceId: orgId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { domain: result.domain, status: result.status },
  })

  return NextResponse.json({ ok: true, domain: result.domain, status: result.status }, { status: 201 })
}

async function _DELETE(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!
  const { orgId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { domain?: string }
  const domain = String(body.domain || '').trim()
  if (!domain) return NextResponse.json({ error: 'domain_required' }, { status: 400 })

  const removed = await removePartnerDomain(pool, orgId, domain)
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'connect.partner.remove',
    resourceKind: 'organization',
    resourceId: orgId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { domain },
  })

  return NextResponse.json({ ok: true, removed: true })
}

export const GET    = tracedRoute('GET', '/api/admin/org/[orgId]/connect-allowlist', _GET)
export const POST   = tracedRoute('POST', '/api/admin/org/[orgId]/connect-allowlist', _POST)
export const DELETE = tracedRoute('DELETE', '/api/admin/org/[orgId]/connect-allowlist', _DELETE)
