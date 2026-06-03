import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getFileSharingPolicy, setFileSharingPolicy, type FileSharingPolicy } from '@/lib/files/publicLinks'

/**
 * File sharing policy (D12) — org control for external file sharing.
 *
 * GET /api/admin/file-sharing-policy — get the policy
 * PUT /api/admin/file-sharing-policy — toggle public links (admin only)
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
  return NextResponse.json({ policy: await getFileSharingPolicy(getPool()!) })
}

async function _PUT(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!

  const body = (await req.json().catch(() => ({}))) as Partial<FileSharingPolicy>
  const patch: Partial<FileSharingPolicy> = {}
  if (typeof body.public_links_enabled === 'boolean') patch.public_links_enabled = body.public_links_enabled

  const policy = await setFileSharingPolicy(pool, patch)
  await pool.query(
    `INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, metadata, created_at)
     VALUES ($1, $2, 'file_sharing_policy_updated', 'system', $3, $4)`,
    [randomUUID(), uid, JSON.stringify(patch), Date.now()]
  ).catch(() => { /* best-effort */ })

  return NextResponse.json({ policy })
}

export const GET = tracedRoute('GET', '/api/admin/file-sharing-policy', _GET)
export const PUT = tracedRoute('PUT', '/api/admin/file-sharing-policy', _PUT)
