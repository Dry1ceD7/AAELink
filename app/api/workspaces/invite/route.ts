import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Workspace invite links.
 * POST /api/workspaces/invite  { workspace_id } → generate invite token
 * GET  /api/workspaces/invite?token=...          → resolve invite
 * PATCH /api/workspaces/invite { token }         → accept invite (join workspace)
 */

/** POST — create a new invite link. Only admins or workspace owners. */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string }
  const wsId = String(body.workspace_id || '').trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  try {
    // Verify caller is admin or workspace member
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    const role = uRows[0]?.platform_role || ''
    if (!isPlatformAdmin(role)) {
      // Check if user is workspace owner/admin
      const { rows: wmRows } = await pool.query<{ role: string }>(
        `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [wsId, uid]
      )
      const wRole = wmRows[0]?.role || ''
      if (!['owner', 'admin'].includes(wRole)) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    }

    // Verify workspace exists
    const { rows: wsRows } = await pool.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM aaelink.workspaces WHERE id = $1`, [wsId]
    )
    if (!wsRows[0]) return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 })

    const token = randomUUID().replace(/-/g, '').slice(0, 24)
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days

    // Create invite record
    await pool.query(
      `INSERT INTO aaelink.workspace_invites (id, workspace_id, created_by, token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), wsId, uid, token, expiresAt, Date.now()]
    )

    const inviteUrl = `/invite/${token}`

    return NextResponse.json({
      token,
      invite_url: inviteUrl,
      expires_at: expiresAt,
      workspace_name: wsRows[0].display_name
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invite_creation_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** GET — resolve an invite token. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const token = req.nextUrl.searchParams.get('token')?.trim() || ''
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 })

  try {
    const { rows } = await pool.query<{
      workspace_id: string; expires_at: number; workspace_name: string
    }>(
      `SELECT wi.workspace_id, wi.expires_at, w.display_name AS workspace_name
       FROM aaelink.workspace_invites wi
       JOIN aaelink.workspaces w ON w.id = wi.workspace_id
       WHERE wi.token = $1`,
      [token]
    )

    if (!rows[0]) return NextResponse.json({ error: 'invalid_invite' }, { status: 404 })
    if (rows[0].expires_at < Date.now()) return NextResponse.json({ error: 'invite_expired' }, { status: 410 })

    return NextResponse.json({
      workspace_id: rows[0].workspace_id,
      workspace_name: rows[0].workspace_name,
      expires_at: rows[0].expires_at
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invite_resolve_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** PATCH — accept an invite (join workspace). */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  const token = String(body.token || '').trim()
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 })

  try {
    const { rows } = await pool.query<{ workspace_id: string; expires_at: number }>(
      `SELECT workspace_id, expires_at FROM aaelink.workspace_invites WHERE token = $1`,
      [token]
    )
    if (!rows[0]) return NextResponse.json({ error: 'invalid_invite' }, { status: 404 })
    if (rows[0].expires_at < Date.now()) return NextResponse.json({ error: 'invite_expired' }, { status: 410 })

    // Join workspace
    await pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [rows[0].workspace_id, uid]
    )

    // Auto-join the new member into all open (public) channels in the workspace
    // so they don't see an empty channel list on first load.
    const { rows: openChannels } = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.channels WHERE workspace_id = $1 AND type = 'O' AND archived_at = 0`,
      [rows[0].workspace_id]
    )
    const now = Date.now()
    for (const ch of openChannels) {
      await pool.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [ch.id, uid, now]
      )
    }

    return NextResponse.json({ ok: true, workspace_id: rows[0].workspace_id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invite_accept_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/workspaces/invite', _GET)
export const POST   = tracedRoute('POST', '/api/workspaces/invite', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/workspaces/invite', _PATCH)
