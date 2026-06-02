import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getPubSub, presenceTopic, type PubSubEvent } from '@/lib/realtime/redisPubSub'
import { log } from '@/lib/infra/log'

/** Client heartbeat: marks the signed-in user as recently active (for presence). */
async function _POST() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const now = Date.now()
  await pool.query(`UPDATE aaelink.users SET last_seen_at = $1 WHERE id = $2`, [now, uid])
  await emitPresence(uid, now)
  return NextResponse.json({ ok: true, last_seen_at: now })
}

/**
 * Emit a `presence` event on the global presence topic for the WS gateway.
 * Wrapped in try/catch so a Redis outage cannot break the heartbeat 200 —
 * the DB row is the source of truth for the legacy SSE consumers.
 *
 * The status is always `online` because every heartbeat is a sign of life;
 * `useAutoAway` and the `getStatus()` derivation in `usePresenceListener`
 * apply the away-after-idle / DND overrides on the consumer side.
 */
async function emitPresence(userId: string, lastSeen: number): Promise<void> {
  const event: PubSubEvent = {
    type: 'presence',
    user_id: userId,
    status: 'online',
    last_seen: lastSeen,
  }
  try {
    await getPubSub().publish(presenceTopic(), event)
  } catch (err) {
    log.warn('collab.presence.emit_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/collab/presence', _POST)
