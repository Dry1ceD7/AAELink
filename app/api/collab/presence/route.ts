import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getPubSub, presenceTopic, type PubSubEvent } from '@/lib/realtime/redisPubSub'
import type { Pool } from 'pg'
import type { Presence, PresencePayload } from '@/lib/types/presence'
import { log } from '@/lib/infra/log'

/** A user is "away" once their last heartbeat is older than this. */
const AWAY_AFTER_MS = 10 * 60 * 1000

type PresenceRow = {
  last_seen_at: string | number | null
  status: string | null
  status_text: string | null
  status_emoji: string | null
  expires_at: string | number | null
}

/**
 * Resolve the canonical fan-out payload for one user.
 *
 * - LEFT JOIN aaelink.user_status for the manual status + custom-status expiry.
 * - status_text / status_emoji come from aaelink.users (custom status = user data).
 * - status is derived server-side: dnd (manual DND active now) > away (last_seen
 *   older than ~10 min) > active (recently seen) > offline (never seen).
 * - An expired custom status (expires_at > 0 and in the past) is treated as
 *   cleared: emoji/text come back empty and expires_at is 0.
 */
export async function resolvePresencePayload(
  pool: Pool,
  userId: string,
  now: number = Date.now(),
): Promise<PresencePayload | null> {
  const { rows } = await pool.query<PresenceRow>(
    `SELECT u.last_seen_at, us.status, u.status_text, u.status_emoji, us.expires_at
     FROM aaelink.users u
     LEFT JOIN aaelink.user_status us ON us.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  )
  const row = rows[0]
  if (!row) return null
  return rowToPresencePayload(userId, row, now)
}

/** Pure mapper from a presence DB row to the derived fan-out payload. */
export function rowToPresencePayload(
  userId: string,
  row: PresenceRow,
  now: number = Date.now(),
): PresencePayload {
  const lastSeen = Number(row.last_seen_at) || 0
  const expiresAt = Number(row.expires_at) || 0
  const customExpired = expiresAt > 0 && expiresAt < now
  const manual = (row.status || '').toLowerCase()

  const status: Presence = deriveStatus(manual, lastSeen, now)

  return {
    user_id: userId,
    status,
    custom_emoji: customExpired ? '' : (row.status_emoji || ''),
    custom_text: customExpired ? '' : (row.status_text || ''),
    expires_at: customExpired ? 0 : expiresAt,
    last_seen: lastSeen,
  }
}

/**
 * Server-side presence derivation:
 *   - dnd     → manual DND is set
 *   - offline → never seen (no heartbeat) or manual offline
 *   - away    → last_seen older than ~10 min (or manual away)
 *   - active  → recently seen
 */
function deriveStatus(manual: string, lastSeen: number, now: number): Presence {
  if (manual === 'dnd') return 'dnd'
  if (manual === 'offline') return 'offline'
  if (lastSeen <= 0) return 'offline'
  if (manual === 'away') return 'away'
  if (now - lastSeen >= AWAY_AFTER_MS) return 'away'
  return 'active'
}

/** Client heartbeat: marks the signed-in user as recently active (for presence). */
async function _POST() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const now = Date.now()
  await pool.query(`UPDATE aaelink.users SET last_seen_at = $1 WHERE id = $2`, [now, uid])
  await emitPresence(uid)
  return NextResponse.json({ ok: true, last_seen_at: now })
}

/**
 * Emit a `presence` event on the global presence topic for the WS gateway.
 * Wrapped in try/catch so a Redis outage cannot break the heartbeat 200 —
 * the DB row is the source of truth for the legacy SSE consumers.
 *
 * The status is derived server-side from the manual user_status row + the
 * just-written last_seen recency (active/away/dnd/offline), and the custom
 * status emoji/text are joined in. An expired custom status is treated as
 * cleared. Consumers no longer need to re-derive status from last_seen.
 */
async function emitPresence(userId: string): Promise<void> {
  try {
    const pool = getPool()
    if (!pool) return
    // A heartbeat must always emit presence. If the row resolve returns nothing
    // (race / missing row), fall back to an active payload — the caller just
    // authenticated and wrote last_seen, so they are present.
    const payload = (await resolvePresencePayload(pool, userId)) ?? {
      user_id: userId, status: 'active' as const, custom_emoji: '', custom_text: '', expires_at: 0, last_seen: Date.now(),
    }
    const event: PubSubEvent = {
      type: 'presence',
      user_id: payload.user_id,
      status: payload.status,
      last_seen: payload.last_seen,
      custom_emoji: payload.custom_emoji,
      custom_text: payload.custom_text,
      expires_at: payload.expires_at,
    }
    await getPubSub().publish(presenceTopic(), event)
  } catch (err) {
    log.warn('collab.presence.emit_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/collab/presence', _POST)
