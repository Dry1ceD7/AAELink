// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { isDndActiveNow } from '@/lib/notifications/dndWindow'

/**
 * Do Not Disturb (DND) schedule API.
 *
 * GET  /api/dnd?user_id=...           — get DND settings for a user (defaults to self)
 * PUT  /api/dnd                       — update own DND settings
 * POST /api/dnd/snooze { duration_minutes } — quick-snooze for N minutes
 *
 * DND schema:
 *   enabled       — whether DND is permanently on
 *   start_time    — daily start time in HH:MM (24h format)
 *   end_time      — daily end time in HH:MM
 *   timezone      — IANA timezone (e.g. 'Asia/Bangkok')
 *   snooze_until  — epoch ms when a temporary snooze expires (0 = not snoozed)
 */

/** GET — read DND settings */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const targetUser = req.nextUrl.searchParams.get('user_id')?.trim() || uid

  const { rows } = await pool.query<{
    enabled: boolean
    start_time: string
    end_time: string
    timezone: string
    snooze_until: string
    updated_at: string
  }>(
    `SELECT enabled, start_time, end_time, timezone, snooze_until, updated_at
     FROM aaelink.dnd_settings
     WHERE user_id = $1`,
    [targetUser]
  )

  if (!rows[0]) {
    // Return defaults (no DND configured)
    return NextResponse.json({
      dnd: {
        enabled: false,
        start_time: '22:00',
        end_time: '08:00',
        timezone: 'UTC',
        snooze_until: 0,
        is_snoozed: false,
        is_active: false
      }
    })
  }

  const r = rows[0]
  const snoozeUntil = Number(r.snooze_until)
  const now = Date.now()
  const isSnoozed = snoozeUntil > now

  // Determine if DND is currently active based on schedule
  let isActive = false
  if (r.enabled) {
    isActive = isDndActiveNow(r.start_time, r.end_time, r.timezone)
  }
  if (isSnoozed) isActive = true

  return NextResponse.json({
    dnd: {
      enabled: r.enabled,
      start_time: r.start_time,
      end_time: r.end_time,
      timezone: r.timezone,
      snooze_until: snoozeUntil,
      is_snoozed: isSnoozed,
      is_active: isActive
    }
  })
}

/** PUT — update DND schedule */
async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean
    start_time?: string
    end_time?: string
    timezone?: string
  }

  const enabled = body.enabled ?? false
  const startTime = validateTime(body.start_time) || '22:00'
  const endTime = validateTime(body.end_time) || '08:00'
  const timezone = body.timezone?.trim() || 'UTC'
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.dnd_settings (user_id, enabled, start_time, end_time, timezone, snooze_until, updated_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       timezone = EXCLUDED.timezone,
       updated_at = EXCLUDED.updated_at`,
    [uid, enabled, startTime, endTime, timezone, now]
  )

  return NextResponse.json({
    ok: true,
    dnd: { enabled, start_time: startTime, end_time: endTime, timezone }
  })
}

/** POST — quick snooze for N minutes */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    duration_minutes?: number
    action?: 'snooze' | 'end_snooze'
  }

  const now = Date.now()

  if (body.action === 'end_snooze') {
    await pool.query(
      `INSERT INTO aaelink.dnd_settings (user_id, enabled, start_time, end_time, timezone, snooze_until, updated_at)
       VALUES ($1, false, '22:00', '08:00', 'UTC', 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET snooze_until = 0, updated_at = $2`,
      [uid, now]
    )
    return NextResponse.json({ ok: true, snooze_until: 0 })
  }

  const minutes = Math.min(Math.max(Number(body.duration_minutes) || 30, 1), 1440) // 1 min to 24 hours
  const snoozeUntil = now + minutes * 60 * 1000

  await pool.query(
    `INSERT INTO aaelink.dnd_settings (user_id, enabled, start_time, end_time, timezone, snooze_until, updated_at)
     VALUES ($1, false, '22:00', '08:00', 'UTC', $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET snooze_until = $2, updated_at = $3`,
    [uid, snoozeUntil, now]
  )

  return NextResponse.json({ ok: true, snooze_until: snoozeUntil, duration_minutes: minutes })
}

// ── Helpers ──────────────────────────────────────────────────────────────

function validateTime(t?: string): string | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET',  '/api/dnd', _GET)
export const PUT  = tracedRoute('PUT',  '/api/dnd', _PUT)
export const POST = tracedRoute('POST', '/api/dnd', _POST)
