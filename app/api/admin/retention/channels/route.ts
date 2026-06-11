// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Per-channel retention overrides — Slack admin.conversations.
 * setCustomRetention / getCustomRetention parity (Admin 14).
 *
 *   GET    /api/admin/retention/channels            — list all overrides
 *   GET    /api/admin/retention/channels?channel_id — get one (404 if absent)
 *   PUT    /api/admin/retention/channels            — set/upsert an override
 *   DELETE /api/admin/retention/channels?channel_id — clear an override
 *
 * An override's window wins over the workspace/channel/dm scope policy for that
 * channel; absence falls back to the scope policy. Enforcement lives in
 * lib/enterprise/retentionOverrides.ts (hold-aware — legal holds always win).
 * Platform-admin gated, CSRF-checked on mutations, audited on writes.
 */

/** Resolve the caller's platform role; returns null if not a platform admin. */
async function requireAdmin(
  pool: NonNullable<ReturnType<typeof getPool>>, uid: string
): Promise<boolean> {
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  return isPlatformAdmin(rows[0]?.platform_role)
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim()
  if (channelId) {
    const { rows } = await pool.query(
      `SELECT o.*, u.username AS updated_by_username
         FROM aaelink.channel_retention_overrides o
         LEFT JOIN aaelink.users u ON u.id = o.updated_by
        WHERE o.channel_id = $1`, [channelId]
    )
    if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ override: rows[0] })
  }

  const { rows } = await pool.query(
    `SELECT o.*, u.username AS updated_by_username
       FROM aaelink.channel_retention_overrides o
       LEFT JOIN aaelink.users u ON u.id = o.updated_by
      ORDER BY o.updated_at DESC`
  )
  return NextResponse.json({ overrides: rows })
}

async function _PUT(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string; retention_days?: number; enabled?: boolean
  }
  const channelId = body.channel_id?.trim()
  if (!channelId) return NextResponse.json({ error: 'invalid_channel_id' }, { status: 400 })
  if (typeof body.retention_days !== 'number' || body.retention_days < 0) {
    return NextResponse.json({ error: 'invalid_retention_days' }, { status: 400 })
  }
  const enabled = body.enabled ?? true

  // Channel must exist — an override keyed off a non-existent channel is a bug.
  const { rows: chRows } = await pool.query(
    `SELECT id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  if (chRows.length === 0) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  const { rows } = await pool.query(
    `INSERT INTO aaelink.channel_retention_overrides
       (channel_id, retention_days, enabled, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (channel_id) DO UPDATE
       SET retention_days = EXCLUDED.retention_days,
           enabled = EXCLUDED.enabled,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [channelId, body.retention_days, enabled, uid]
  )

  writeAuditLog({
    pool, actorId: uid,
    action: 'retention.channel_override.set',
    resourceKind: 'channel_override', resourceId: channelId,
    metadata: { channel_id: channelId, retention_days: body.retention_days, enabled },
  })

  return NextResponse.json({ override: rows[0] })
}

async function _DELETE(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim()
  if (!channelId) return NextResponse.json({ error: 'invalid_channel_id' }, { status: 400 })

  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.channel_retention_overrides WHERE channel_id = $1`, [channelId]
  )
  if (!rowCount) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  writeAuditLog({
    pool, actorId: uid,
    action: 'retention.channel_override.clear',
    resourceKind: 'channel_override', resourceId: channelId,
    metadata: { channel_id: channelId },
  })

  return NextResponse.json({ cleared: true, channel_id: channelId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/admin/retention/channels', _GET)
export const PUT    = tracedRoute('PUT',    '/api/admin/retention/channels', _PUT)
export const DELETE = tracedRoute('DELETE', '/api/admin/retention/channels', _DELETE)
