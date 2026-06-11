// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Workspace Invite Link API — Slack-style shareable invite URLs.
 *
 * POST /api/workspaces/invite-link   — create a new invite link
 * GET  /api/workspaces/invite-link?workspace_id=...  — list active invite links
 * DELETE /api/workspaces/invite-link?link_id=...     — revoke an invite link
 *
 * Invite links can be:
 *   - Single-use or multi-use
 *   - Time-limited (expiry date)
 *   - Restricted to specific email domains
 */

/** POST — create a new invite link */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    max_uses?: number
    expires_in_hours?: number
    allowed_domains?: string[]
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Check admin role
  const { rows: memberRows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  if (!memberRows[0]) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })
  if (!['admin', 'owner'].includes(memberRows[0].role)) {
    // Check platform admin
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'admin_required' }, { status: 403 })
    }
  }

  const id = randomUUID()
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').substring(0, 8)
  const now = Date.now()
  const maxUses = body.max_uses || 0 // 0 = unlimited
  const expiresAt = body.expires_in_hours
    ? now + body.expires_in_hours * 60 * 60 * 1000
    : 0 // 0 = never expires
  const allowedDomains = Array.isArray(body.allowed_domains) ? body.allowed_domains : []

  await pool.query(`
    INSERT INTO aaelink.workspace_invite_links
      (id, workspace_id, token, created_by, max_uses, use_count, expires_at, allowed_domains, active, created_at)
    VALUES ($1, $2, $3, $4, $5, 0, $6, $7, true, $8)
  `, [id, workspaceId, token, uid, maxUses, expiresAt, JSON.stringify(allowedDomains), now])

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const inviteUrl = `${baseUrl}/join/${token}`

  return NextResponse.json({
    link: {
      id,
      token,
      url: inviteUrl,
      max_uses: maxUses,
      expires_at: expiresAt || null,
      allowed_domains: allowedDomains,
      created_at: now
    }
  })
}

/** GET — list active invite links for a workspace */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const { rows } = await pool.query(`
    SELECT il.id, il.token, il.max_uses, il.use_count, il.expires_at,
           il.allowed_domains, il.active, il.created_at,
           u.username AS created_by_username
    FROM aaelink.workspace_invite_links il
    LEFT JOIN aaelink.users u ON u.id = il.created_by
    WHERE il.workspace_id = $1 AND il.active = true
    ORDER BY il.created_at DESC
  `, [workspaceId])

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const links = rows.map(r => ({
    ...r,
    url: `${baseUrl}/join/${r.token}`,
    is_expired: r.expires_at > 0 && Number(r.expires_at) < Date.now(),
    is_exhausted: r.max_uses > 0 && Number(r.use_count) >= Number(r.max_uses)
  }))

  return NextResponse.json({ links, total: links.length })
}

/** DELETE — revoke an invite link */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const linkId = req.nextUrl.searchParams.get('link_id')?.trim() || ''
  if (!linkId) return NextResponse.json({ error: 'link_id_required' }, { status: 400 })

  const { rowCount } = await pool.query(
    `UPDATE aaelink.workspace_invite_links SET active = false WHERE id = $1`,
    [linkId]
  )

  if (!rowCount) return NextResponse.json({ error: 'link_not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, revoked: linkId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/workspaces/invite-link', _GET)
export const POST   = tracedRoute('POST', '/api/workspaces/invite-link', _POST)
export const DELETE = tracedRoute('DELETE', '/api/workspaces/invite-link', _DELETE)
