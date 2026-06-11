import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'

/**
 * Conversations Mark API — Slack conversations.mark parity.
 *
 * POST /api/conversations/mark — mark a conversation as read up to a timestamp
 *
 * Equivalent to conversations.mark — updates the last-read cursor for the user.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel?: string; ts?: string
  }

  if (!body.channel || !body.ts) {
    return NextResponse.json({ ok: false, error: 'channel and ts required' }, { status: 400 })
  }

  const lastRead = Number(body.ts) || Date.now()

  // Verify channel access before writing the read cursor — channel_read_state
  // has a NOT NULL FK to channels, so an unchecked/stale channel id would raise
  // an unhandled FK violation (500). Also satisfies the per-channel-access rule.
  if (!(await userCanReadChannel(pool, uid, body.channel))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Upsert read state
  await pool.query(`
    INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = $3
  `, [uid, body.channel, lastRead])

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/conversations/mark', _POST)
