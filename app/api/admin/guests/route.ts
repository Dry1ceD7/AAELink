import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Guest Accounts API (Slack "Guest" / external collaborator).
 *
 * GET  /api/admin/guests?workspace_id=...  — list guest users
 * POST /api/admin/guests                   — invite a guest to specific channels
 * PATCH /api/admin/guests                  — update guest channel access
 * DELETE /api/admin/guests                 — revoke guest access
 *
 * Guests:
 *   - Can only access explicitly assigned channels
 *   - Cannot browse/discover channels
 *   - Cannot create channels or DMs
 *   - Have a "guest" role on workspace_members
 *   - Have an expiration date (optional)
 */

/** GET — list guest users in a workspace */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const { rows } = await pool.query(`
    SELECT
      g.id, g.workspace_id, g.user_id, g.invited_by,
      g.expires_at, g.created_at,
      u.username, u.email, u.first_name, u.last_name, u.avatar_url,
      ib.username AS invited_by_username,
      (SELECT array_agg(gc.channel_id) FROM aaelink.guest_channel_access gc WHERE gc.guest_id = g.id) AS channel_ids
    FROM aaelink.guest_accounts g
    JOIN aaelink.users u ON u.id = g.user_id
    LEFT JOIN aaelink.users ib ON ib.id = g.invited_by
    WHERE g.workspace_id = $1
    ORDER BY g.created_at DESC
  `, [workspaceId])

  return NextResponse.json({ guests: rows })
}

/** POST — invite a guest to specific channels */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Must be admin
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    // Also allow workspace admins
    const body2 = (await req.clone().json().catch(() => ({}))) as { workspace_id?: string }
    if (body2.workspace_id) {
      const { rows: wmRows } = await pool.query<{ role: string }>(
        `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [body2.workspace_id, uid]
      )
      if (!['owner', 'admin'].includes(wmRows[0]?.role || '')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    } else {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    user_id?: string
    email?: string
    channel_ids?: string[]
    expires_at?: number
  }

  const workspaceId = String(body.workspace_id || '').trim()
  const guestUserId = String(body.user_id || '').trim()
  const channelIds = body.channel_ids || []
  const expiresAt = body.expires_at || 0

  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!guestUserId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
  if (channelIds.length === 0) return NextResponse.json({ error: 'channel_ids_required' }, { status: 400 })

  const id = randomUUID()
  const now = Date.now()

  // Create guest account record
  await pool.query(
    `INSERT INTO aaelink.guest_accounts (id, workspace_id, user_id, invited_by, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET expires_at = $5`,
    [id, workspaceId, guestUserId, uid, expiresAt, now]
  )

  // Add workspace membership with guest role
  await pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role, joined_at)
     VALUES ($1, $2, 'guest', $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'guest'`,
    [workspaceId, guestUserId, now]
  )

  // Assign channel access
  for (const chId of channelIds) {
    await pool.query(
      `INSERT INTO aaelink.guest_channel_access (guest_id, channel_id, granted_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (guest_id, channel_id) DO NOTHING`,
      [id, chId, now]
    )
    // Also add as channel member
    await pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [chId, guestUserId, now]
    ).catch(() => {})
  }

  return NextResponse.json({ guest: { id, workspace_id: workspaceId, user_id: guestUserId, channel_ids: channelIds } })
}

/** DELETE — revoke guest access */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { guest_id?: string; workspace_id?: string }
  const guestId = String(body.guest_id || '').trim()
  if (!guestId) return NextResponse.json({ error: 'guest_id_required' }, { status: 400 })

  // Get guest info before deletion
  const { rows: guestRows } = await pool.query<{ user_id: string; workspace_id: string }>(
    `SELECT user_id, workspace_id FROM aaelink.guest_accounts WHERE id = $1`,
    [guestId]
  )
  if (!guestRows[0]) return NextResponse.json({ error: 'guest_not_found' }, { status: 404 })

  const guest = guestRows[0]

  // Remove channel access and membership
  const { rows: access } = await pool.query<{ channel_id: string }>(
    `SELECT channel_id FROM aaelink.guest_channel_access WHERE guest_id = $1`,
    [guestId]
  )
  for (const a of access) {
    await pool.query(
      `DELETE FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [a.channel_id, guest.user_id]
    )
  }

  // Remove guest account and workspace membership
  await pool.query(`DELETE FROM aaelink.guest_accounts WHERE id = $1`, [guestId])
  await pool.query(
    `DELETE FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'guest'`,
    [guest.workspace_id, guest.user_id]
  )

  // Audit log
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, 'guest.revoke', $4, $5, $6)`,
      [randomUUID(), guest.workspace_id, uid, guestId, JSON.stringify({ user_id: guest.user_id }), Date.now()]
    )
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/guests', _GET)
export const POST   = tracedRoute('POST', '/api/admin/guests', _POST)
export const DELETE = tracedRoute('DELETE', '/api/admin/guests', _DELETE)
