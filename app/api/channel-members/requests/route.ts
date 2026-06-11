import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Channel membership requests — join-request / approval flow for private channels.
 *
 *   GET  /api/channel-members/requests?channel_id=...   — list pending requests (channel admin only)
 *   POST /api/channel-members/requests
 *        { channel_id }                                  — request to join (the caller)
 *        { channel_id, request_id, action: 'approve' }   — approve a pending request (channel admin)
 *        { channel_id, request_id, action: 'deny' }      — deny a pending request (channel admin)
 *
 * Backed by aaelink.channel_member_requests (migration 061). Status is one of
 * 'pending' | 'approved' | 'denied'. Approving adds the requester to
 * channel_members. Platform admins and per-channel admins/owners may moderate;
 * any workspace member may request to join. CSRF-checked + audited on writes.
 */

type RequestRow = {
  id: string
  channel_id: string
  user_id: string
  status: string
  created_at: string
}

/** True when the caller is a platform admin or a per-channel admin/owner. */
async function canModerate(pool: Pool, uid: string, channelId: string): Promise<boolean> {
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (isPlatformAdmin(uRows[0]?.platform_role)) return true
  const { rows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  const role = rows[0]?.role
  return role === 'admin' || role === 'owner'
}

/** GET — list pending join requests for a channel (channel admins only). */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim() || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  if (!(await canModerate(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<RequestRow & {
    username: string; first_name: string | null; last_name: string | null; avatar_url: string | null
  }>(
    `SELECT r.id, r.channel_id, r.user_id, r.status, r.created_at::text AS created_at,
            u.username, u.first_name, u.last_name, u.avatar_url
       FROM aaelink.channel_member_requests r
       JOIN aaelink.users u ON u.id = r.user_id
      WHERE r.channel_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at ASC`,
    [channelId]
  )

  return NextResponse.json({
    requests: rows.map(r => ({
      id: r.id,
      channel_id: r.channel_id,
      user_id: r.user_id,
      status: r.status,
      created_at: Number(r.created_at) || 0,
      username: r.username,
      first_name: r.first_name || '',
      last_name: r.last_name || '',
      avatar_url: r.avatar_url || null,
    })),
  })
}

/** POST — request to join, or approve/deny an existing request. */
async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    request_id?: string
    action?: 'approve' | 'deny'
  }
  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Channel must exist; capture workspace for membership + audit scope.
  const { rows: chRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  const ch = chRows[0]
  if (!ch) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  // ── Moderation path (approve / deny) ─────────────────────────────
  if (body.action) {
    const requestId = String(body.request_id || '').trim()
    if (!requestId) return NextResponse.json({ error: 'request_id_required' }, { status: 400 })
    if (body.action !== 'approve' && body.action !== 'deny') {
      return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
    }
    if (!(await canModerate(pool, uid, channelId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const { rows: reqRows } = await pool.query<RequestRow>(
      `SELECT id, channel_id, user_id, status, created_at::text AS created_at
         FROM aaelink.channel_member_requests
        WHERE id = $1 AND channel_id = $2`,
      [requestId, channelId]
    )
    const request = reqRows[0]
    if (!request) return NextResponse.json({ error: 'request_not_found' }, { status: 404 })
    if (request.status !== 'pending') {
      return NextResponse.json({ error: 'request_not_pending' }, { status: 409 })
    }

    const nextStatus = body.action === 'approve' ? 'approved' : 'denied'
    await pool.query(
      `UPDATE aaelink.channel_member_requests SET status = $1 WHERE id = $2`,
      [nextStatus, requestId]
    )

    if (body.action === 'approve') {
      // Ensure the requester is a workspace member, then add to the channel.
      await pool.query(
        `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [ch.workspace_id, request.user_id]
      )
      await pool.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [channelId, request.user_id, Date.now()]
      )
    }

    writeAuditLog({
      pool,
      workspaceId: ch.workspace_id,
      actorId: uid,
      action: body.action === 'approve' ? 'channel.member.request.approve' : 'channel.member.request.deny',
      resourceKind: 'channel_member_request',
      resourceId: requestId,
      metadata: { channel_id: channelId, user_id: request.user_id, status: nextStatus },
    })

    return NextResponse.json({ ok: true, request_id: requestId, status: nextStatus })
  }

  // ── Request-to-join path (the caller requests membership) ────────
  // Must belong to the workspace to request a channel within it.
  const { rows: wsRows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [ch.workspace_id, uid]
  )
  if (!wsRows[0]) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Already a member — no request needed.
  const { rows: memRows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  if (memRows[0]) return NextResponse.json({ error: 'already_member' }, { status: 409 })

  // Collapse duplicate pending requests into the existing one.
  const { rows: existing } = await pool.query<RequestRow>(
    `SELECT id, channel_id, user_id, status, created_at::text AS created_at
       FROM aaelink.channel_member_requests
      WHERE channel_id = $1 AND user_id = $2 AND status = 'pending'`,
    [channelId, uid]
  )
  if (existing[0]) {
    return NextResponse.json({ ok: true, request_id: existing[0].id, status: 'pending' })
  }

  const id = randomUUID()
  await pool.query(
    `INSERT INTO aaelink.channel_member_requests (id, channel_id, user_id, status, created_at)
     VALUES ($1, $2, $3, 'pending', $4)`,
    [id, channelId, uid, Date.now()]
  )

  writeAuditLog({
    pool,
    workspaceId: ch.workspace_id,
    actorId: uid,
    action: 'channel.member.request.create',
    resourceKind: 'channel_member_request',
    resourceId: id,
    metadata: { channel_id: channelId },
  })

  return NextResponse.json({ ok: true, request_id: id, status: 'pending' })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET',  '/api/channel-members/requests', _GET)
export const POST = tracedRoute('POST', '/api/channel-members/requests', _POST)
