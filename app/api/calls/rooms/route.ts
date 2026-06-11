import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { turnConfigured } from '@/lib/calls/turnCredentials'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { emitWebhookEvent } from '@/lib/webhooks/webhookEmitter'

/**
 * Calls & Huddles API — call signaling, room management, and screen share sessions.
 *
 * GET  /api/calls/rooms — list active/recent call rooms
 * POST /api/calls/rooms — create a call room (voice, video, huddle, screen-share)
 * PUT  /api/calls/rooms — join/leave/end a call, toggle screen share
 *
 * Call types:
 *   - voice       — audio-only call (1:1 or group)
 *   - video       — video call (1:1 or group)
 *   - huddle      — persistent ad-hoc room in a channel
 *   - screen_share — screen sharing session
 *
 * Signaling model:
 *   Server-side room state + participant tracking.
 *   WebRTC SDP/ICE exchange happens client-side with TURN server.
 *   This API manages the control plane (create/join/leave/end).
 *
 * Admin settings:
 *   - max_participants, recording enabled, blur backgrounds, noise suppression
 *   - TURN/STUN server configuration
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const status = req.nextUrl.searchParams.get('status') || 'active'
  const view = req.nextUrl.searchParams.get('view') || ''

  // Admin config view
  if (view === 'config') {
    const { rows: cfgRows } = await pool.query<{ value: string }>(
      `SELECT value FROM aaelink.system_config WHERE key = 'calls_config'`
    )
    const defaultConfig = {
      enabled: true,
      max_participants: 50,
      recording_enabled: false,
      recording_storage: 's3',
      background_blur: true,
      noise_suppression: true,
      screen_share_enabled: true,
      huddles_enabled: true,
      // Per-user ephemeral TURN credentials are issued at GET /api/calls/ice;
      // this admin view reports the configured server URLs + whether a TURN
      // shared secret is present, never static credentials.
      turn_servers: (process.env.TURN_URLS || 'turn:turn.aaelink.local:3478').split(',').map(s => s.trim()).filter(Boolean),
      turn_configured: turnConfigured(),
      stun_servers: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
      ice_timeout_seconds: 30,
    }
    let config = defaultConfig
    if (cfgRows[0]?.value) { try { config = { ...defaultConfig, ...JSON.parse(cfgRows[0].value) } } catch { /**/ } }
    return NextResponse.json({ config })
  }

  let where = 'WHERE 1=1'
  const params: string[] = []

  if (channelId) { params.push(channelId); where += ` AND r.channel_id = $${params.length}` }
  if (['active', 'ended'].includes(status)) { params.push(status); where += ` AND r.status = $${params.length}` }

  const { rows } = await pool.query<{
    id: string; channel_id: string; call_type: string; title: string;
    status: string; recording: boolean; screen_share_user_id: string;
    max_participants: number; created_by: string; created_at: number;
    ended_at: number; created_by_name: string; active_participants: number;
  }>(`
    SELECT r.*, u.username AS created_by_name,
           (SELECT COUNT(*)::int FROM aaelink.call_participants cp WHERE cp.room_id = r.id AND cp.left_at = 0) AS active_participants
    FROM aaelink.call_rooms r
    LEFT JOIN aaelink.users u ON u.id = r.created_by
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 50
  `, params)

  return NextResponse.json({
    rooms: rows.map(r => ({
      ...r,
      created_at: Number(r.created_at),
      ended_at: Number(r.ended_at || 0),
      active_participants: Number(r.active_participants || 0),
    })),
  })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string; call_type?: string; title?: string
    invite_user_ids?: string[]
  }

  const VALID_TYPES = ['voice', 'video', 'huddle', 'screen_share']
  const callType = VALID_TYPES.includes(body.call_type || '') ? body.call_type! : 'voice'

  // For huddles, check if one already exists in this channel
  if (callType === 'huddle' && body.channel_id) {
    const { rows: existing } = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.call_rooms WHERE channel_id = $1 AND call_type = 'huddle' AND status = 'active'`,
      [body.channel_id]
    )
    if (existing.length > 0) {
      return NextResponse.json({
        room: { id: existing[0].id, call_type: 'huddle', already_exists: true },
        instructions: 'Use PUT with action=join to enter the existing huddle.'
      })
    }
  }

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.call_rooms
      (id, channel_id, call_type, title, status, recording, screen_share_user_id,
       max_participants, created_by, created_at, ended_at)
    VALUES ($1, $2, $3, $4, 'active', false, '', 50, $5, $6, 0)
  `, [id, body.channel_id || null, callType, body.title || `${callType} call`, uid, now])

  // Auto-join the creator
  await pool.query(`
    INSERT INTO aaelink.call_participants
      (id, room_id, user_id, role, muted, video_on, screen_sharing, joined_at, left_at)
    VALUES ($1, $2, $3, 'host', false, $4, $5, $6, 0)
  `, [randomUUID(), id, uid,
      callType === 'video' || callType === 'huddle',
      callType === 'screen_share',
      now])

  // Emit call.started best-effort — must not block or fail the create.
  try {
    await emitWebhookEvent(pool, 'call.started', {
      room_id: id, call_type: callType, channel_id: body.channel_id || null, created_by: uid,
    }, uid, body.channel_id || undefined)
  } catch { /* best-effort */ }

  return NextResponse.json({
    room: { id, call_type: callType, status: 'active', created_at: now },
    participant: { role: 'host', joined_at: now },
  }, { status: 201 })
}

async function _PUT(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'join' | 'leave' | 'end' | 'toggle_mute' | 'toggle_video' | 'toggle_screen_share' | 'update_config'
    room_id?: string
    // Config
    config?: Record<string, unknown>
  }

  const roomId = String(body.room_id || '').trim()
  const now = Date.now()

  if (body.action === 'update_config') {
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (uRows[0]?.platform_role !== 'super_admin') {
      return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
    }

    const { rows: cfgRows } = await pool.query<{ value: string }>(
      `SELECT value FROM aaelink.system_config WHERE key = 'calls_config'`
    )
    let current: Record<string, unknown> = {}
    if (cfgRows[0]?.value) { try { current = JSON.parse(cfgRows[0].value) } catch { /**/ } }
    const updated = { ...current, ...body.config }
    await pool.query(`
      INSERT INTO aaelink.system_config (key, value, updated_at)
      VALUES ('calls_config', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
    `, [JSON.stringify(updated), now])
    return NextResponse.json({ config: updated })
  }

  if (!roomId) return NextResponse.json({ error: 'room_id_required' }, { status: 400 })

  if (body.action === 'join') {
    const { rows: room } = await pool.query<{ status: string; max_participants: number }>(
      `SELECT status, max_participants FROM aaelink.call_rooms WHERE id = $1`, [roomId]
    )
    if (!room[0] || room[0].status !== 'active') {
      return NextResponse.json({ error: 'room_not_found_or_ended' }, { status: 404 })
    }

    // Check capacity
    const { rows: [count] } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aaelink.call_participants WHERE room_id = $1 AND left_at = 0`, [roomId]
    )
    if (Number(count.n) >= room[0].max_participants) {
      return NextResponse.json({ error: 'room_full' }, { status: 409 })
    }

    await pool.query(`
      INSERT INTO aaelink.call_participants
        (id, room_id, user_id, role, muted, video_on, screen_sharing, joined_at, left_at)
      VALUES ($1, $2, $3, 'participant', false, false, false, $4, 0)
      ON CONFLICT DO NOTHING
    `, [randomUUID(), roomId, uid, now])

    return NextResponse.json({ ok: true, joined_at: now })
  }

  if (body.action === 'leave') {
    await pool.query(
      `UPDATE aaelink.call_participants SET left_at = $1 WHERE room_id = $2 AND user_id = $3 AND left_at = 0`,
      [now, roomId, uid]
    )
    return NextResponse.json({ ok: true, left_at: now })
  }

  if (body.action === 'end') {
    // Only the room creator (host) or a super_admin may end a call for everyone.
    const { rows: roomRows } = await pool.query<{ created_by: string; status: string; ended_at: string }>(
      `SELECT created_by, status, ended_at::text AS ended_at FROM aaelink.call_rooms WHERE id = $1`, [roomId]
    )
    if (!roomRows[0]) return NextResponse.json({ error: 'room_not_found' }, { status: 404 })
    if (roomRows[0].created_by !== uid) {
      const { rows: uRows } = await pool.query<{ platform_role: string }>(
        `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
      )
      if (uRows[0]?.platform_role !== 'super_admin') {
        return NextResponse.json({ error: 'host_or_admin_only' }, { status: 403 })
      }
    }
    // Idempotent: re-ending an already-ended room must not rewrite ended_at or
    // emit a phantom second audit row.
    if (roomRows[0].status !== 'active') {
      return NextResponse.json({ ok: true, ended_at: Number(roomRows[0].ended_at || 0) })
    }
    // Count the participants this ends the call for (compliance trail).
    const { rows: [endCount] } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aaelink.call_participants WHERE room_id = $1 AND left_at = 0`, [roomId]
    )
    await pool.query(`UPDATE aaelink.call_rooms SET status = 'ended', ended_at = $1 WHERE id = $2`, [now, roomId])
    await pool.query(`UPDATE aaelink.call_participants SET left_at = $1 WHERE room_id = $2 AND left_at = 0`, [now, roomId])

    // Ending a call removes every active participant — a write that affects other
    // users, so it is audited (Hard Rule 5).
    writeAuditLog({
      pool,
      actorId: uid,
      action: 'call.end',
      resourceKind: 'call_room',
      resourceId: roomId,
      ipAddress: extractIp(req),
      userAgent: req.headers.get('user-agent') || '',
      metadata: { ended_at: now, participants_ended: Number(endCount?.n || 0) },
    })

    // Emit call.ended best-effort — must not block or fail the end action.
    try {
      await emitWebhookEvent(pool, 'call.ended', {
        room_id: roomId, ended_at: now, ended_by: uid,
      }, uid)
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, ended_at: now })
  }

  if (body.action === 'toggle_mute') {
    await pool.query(
      `UPDATE aaelink.call_participants SET muted = NOT muted WHERE room_id = $1 AND user_id = $2 AND left_at = 0`,
      [roomId, uid]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'toggle_video') {
    await pool.query(
      `UPDATE aaelink.call_participants SET video_on = NOT video_on WHERE room_id = $1 AND user_id = $2 AND left_at = 0`,
      [roomId, uid]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'toggle_screen_share') {
    await pool.query(
      `UPDATE aaelink.call_participants SET screen_sharing = NOT screen_sharing WHERE room_id = $1 AND user_id = $2 AND left_at = 0`,
      [roomId, uid]
    )
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'action required' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/calls/rooms', _GET)
export const POST   = tracedRoute('POST', '/api/calls/rooms', _POST)
export const PUT    = tracedRoute('PUT', '/api/calls/rooms', _PUT)
