// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Mobile Push Notification API — device registration + delivery management.
 *
 * GET  /api/notifications/push — list registered push devices + delivery stats
 * POST /api/notifications/push — register device token or send push notification
 * PUT  /api/notifications/push — update push settings/policy
 *
 * Push providers:
 *   - apns    — Apple Push Notification Service (iOS)
 *   - fcm     — Firebase Cloud Messaging (Android)
 *   - web     — Web Push API (browser)
 *
 * Features:
 *   - Per-device token registration with platform detection
 *   - Badge count sync
 *   - Silent push for background sync
 *   - Priority levels (high/normal/low)
 *   - Delivery receipt tracking
 *   - Admin push policy (enable/disable, quiet hours, max rate)
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const view = req.nextUrl.searchParams.get('view') || ''

  if (view === 'admin') {
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const { rows: [stats] } = await pool.query<{
      total_tokens: string; apns: string; fcm: string; web: string
      sent_24h: string; delivered_24h: string; failed_24h: string
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE is_active = true) AS total_tokens,
        (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE provider = 'apns' AND is_active = true) AS apns,
        (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE provider = 'fcm' AND is_active = true) AS fcm,
        (SELECT COUNT(*)::text FROM aaelink.push_tokens WHERE provider = 'web' AND is_active = true) AS web,
        (SELECT COUNT(*)::text FROM aaelink.push_log WHERE created_at > $1) AS sent_24h,
        (SELECT COUNT(*)::text FROM aaelink.push_log WHERE status = 'delivered' AND created_at > $1) AS delivered_24h,
        (SELECT COUNT(*)::text FROM aaelink.push_log WHERE status = 'failed' AND created_at > $1) AS failed_24h
    `, [Date.now() - 86400000])

    // Policy
    const { rows: cfgRows } = await pool.query<{ value: string }>(
      `SELECT value FROM aaelink.system_config WHERE key = 'push_policy'`
    )
    const defaultPolicy = {
      enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      quiet_hours_timezone: 'UTC',
      max_rate_per_user_per_hour: 60,
      badge_count_sync: true,
      silent_push_enabled: true,
    }
    let policy = defaultPolicy
    if (cfgRows[0]?.value) { try { policy = { ...defaultPolicy, ...JSON.parse(cfgRows[0].value) } } catch { /**/ } }

    return NextResponse.json({
      stats: {
        total_tokens: Number(stats.total_tokens),
        apns: Number(stats.apns), fcm: Number(stats.fcm), web: Number(stats.web),
        sent_24h: Number(stats.sent_24h),
        delivered_24h: Number(stats.delivered_24h),
        failed_24h: Number(stats.failed_24h),
      },
      policy,
    })
  }

  // User's own push tokens
  const { rows } = await pool.query(`
    SELECT id, provider, device_name, platform, is_active, registered_at, last_push_at
    FROM aaelink.push_tokens
    WHERE user_id = $1
    ORDER BY registered_at DESC
  `, [uid])

  return NextResponse.json({
    tokens: rows.map(r => ({ ...r, registered_at: Number(r.registered_at), last_push_at: Number(r.last_push_at || 0) }))
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'register' | 'unregister' | 'send'
    token?: string; provider?: string; device_name?: string; platform?: string
    token_id?: string
    // Send params
    user_ids?: string[]; title?: string; body_text?: string
    channel_id?: string; priority?: string; badge_count?: number
    silent?: boolean
  }

  if (body.action === 'register' || !body.action) {
    const token = String(body.token || '').trim()
    if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 })

    const provider = ['apns', 'fcm', 'web'].includes(body.provider || '') ? body.provider! : 'fcm'
    const id = randomUUID()
    const now = Date.now()

    // Upsert — same token updates
    await pool.query(`
      INSERT INTO aaelink.push_tokens
        (id, user_id, token, provider, device_name, platform, is_active, registered_at, last_push_at)
      VALUES ($1, $2, $3, $4, $5, $6, true, $7, 0)
      ON CONFLICT (token) DO UPDATE SET
        user_id = $2, is_active = true, device_name = $5, registered_at = $7
    `, [id, uid, token, provider, body.device_name || 'Unknown', body.platform || 'unknown', now])

    return NextResponse.json({ token_id: id, registered: true }, { status: 201 })
  }

  if (body.action === 'unregister') {
    const tokenId = String(body.token_id || '').trim()
    if (!tokenId) return NextResponse.json({ error: 'token_id_required' }, { status: 400 })
    await pool.query(`UPDATE aaelink.push_tokens SET is_active = false WHERE id = $1 AND user_id = $2`, [tokenId, uid])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'send') {
    // Admin-only
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const userIds = Array.isArray(body.user_ids) ? body.user_ids : []
    if (userIds.length === 0) return NextResponse.json({ error: 'user_ids_required' }, { status: 400 })

    const priority = ['high', 'normal', 'low'].includes(body.priority || '') ? body.priority! : 'normal'
    const now = Date.now()
    let queued = 0

    for (const targetId of userIds.slice(0, 100)) {
      const logId = randomUUID()
      await pool.query(`
        INSERT INTO aaelink.push_log
          (id, user_id, title, body, channel_id, priority, silent, badge_count, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)
      `, [logId, targetId, body.title || '', body.body_text || '', body.channel_id || '',
          priority, body.silent || false, body.badge_count || 0, now])
      queued++
    }

    return NextResponse.json({ queued, priority, created_at: now })
  }

  return NextResponse.json({ error: 'action required (register|unregister|send)' }, { status: 400 })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean; quiet_hours_start?: string; quiet_hours_end?: string;
    quiet_hours_timezone?: string; max_rate_per_user_per_hour?: number;
    badge_count_sync?: boolean; silent_push_enabled?: boolean;
  }
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'push_policy'`
  )
  let current: Record<string, unknown> = {}
  if (cfgRows[0]?.value) { try { current = JSON.parse(cfgRows[0].value) } catch { /**/ } }

  const updated = { ...current, ...body }
  const now = Date.now()
  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('push_policy', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  return NextResponse.json({ policy: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/notifications/push', _GET)
export const POST   = tracedRoute('POST', '/api/notifications/push', _POST)
export const PUT    = tracedRoute('PUT', '/api/notifications/push', _PUT)
