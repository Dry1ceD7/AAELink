import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { createPublicLink, revokePublicLinks } from '@/lib/files/publicLinks'

/**
 * File public links (D12).
 *
 * POST   /api/files/:id/public-link — mint (or reuse) a public link. Uploader only.
 * DELETE /api/files/:id/public-link — revoke all public links for the file.
 */
type Ctx = { params: Promise<{ id: string }> }

const ERR_STATUS: Record<string, number> = { sharing_disabled: 403, not_found: 404, forbidden: 403 }

async function _POST(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id: fileId } = await ctx.params

  const result = await createPublicLink(pool, uid, fileId)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR_STATUS[result.code] ?? 400 })

  writeAuditLog({
    pool, actorId: uid, action: 'file.public_link.create', resourceKind: 'file', resourceId: result.fileId,
    ipAddress: extractIp(req), userAgent: req.headers.get('user-agent') || '',
  })
  return NextResponse.json({ ok: true, token: result.token, file_id: result.fileId }, { status: 201 })
}

async function _DELETE(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id: fileId } = await ctx.params

  const result = await revokePublicLinks(pool, uid, fileId)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR_STATUS[result.code] ?? 400 })

  writeAuditLog({
    pool, actorId: uid, action: 'file.public_link.revoke', resourceKind: 'file', resourceId: result.fileId,
    ipAddress: extractIp(req), userAgent: req.headers.get('user-agent') || '',
  })
  return NextResponse.json({ ok: true, file_id: result.fileId })
}

export const POST   = tracedRoute('POST', '/api/files/:id/public-link', _POST)
export const DELETE = tracedRoute('DELETE', '/api/files/:id/public-link', _DELETE)
