/**
 * Integration test for GET /api/dnd is_active timezone correctness.
 *
 * The route must report is_active using the same TZ-aware helper the push
 * engine uses (lib/notifications/dndWindow.isDndActiveNow). Previously the
 * route had its own TZ-less helper that evaluated the window against the
 * server's local wall-clock, disagreeing with push for non-UTC users.
 *
 * Strategy: build a DND window centred on the user's CURRENT local time in a
 * non-UTC timezone (Asia/Bangkok, UTC+7). The user is inside that window in
 * Bangkok time (is_active=true), but the same window does NOT contain the
 * current UTC time — so a TZ-less route would wrongly report is_active=false.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, expectSuccess,
  cleanupTestData, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

const TZ = 'Asia/Bangkok' // UTC+7, no DST — stable offset

/** Minutes-since-midnight for `at` evaluated in the given IANA timezone. */
function minutesInZone(at: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const parts = fmt.formatToParts(at)
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

const hhmm = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

async function getDnd(cookie: string) {
  const { GET } = await import('@/app/api/dnd/route')
  return GET(asRequest('GET', '/api/dnd', { cookie }))
}

async function setSchedule(userId: string, start: string, end: string, timezone: string) {
  await ctx.pool.query(
    `INSERT INTO aaelink.dnd_settings (user_id, enabled, start_time, end_time, timezone, snooze_until, updated_at)
     VALUES ($1, true, $2, $3, $4, 0, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       enabled = true, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
       timezone = EXCLUDED.timezone, snooze_until = 0, updated_at = EXCLUDED.updated_at`,
    [userId, start, end, timezone, Date.now()]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.dnd_settings WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/dnd — is_active respects user timezone', () => {
  it('reports is_active=true inside a window that is current in the user TZ but not in UTC', async () => {
    const now = new Date()
    const localMin = minutesInZone(now, TZ)
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes()
    // Tight window around local-now (±90 min). Guard: this window must NOT
    // contain UTC-now, otherwise the divergence is not demonstrated. The
    // Bangkok offset (+420 min) guarantees separation except near wraparound,
    // which we skip rather than assert a false positive.
    const start = localMin - 90
    const end = localMin + 90
    const inWindow = (m: number) => {
      const s = ((start % 1440) + 1440) % 1440
      const e = ((end % 1440) + 1440) % 1440
      return s < e ? m >= s && m < e : m >= s || m < e
    }
    if (inWindow(utcMin)) {
      // Rare wraparound coincidence; nothing to prove this minute.
      expect(true).toBe(true)
      return
    }

    await setSchedule(user.id, hhmm(start), hhmm(end), TZ)
    const body = await expectSuccess<{ dnd: { is_active: boolean; timezone: string } }>(
      await getDnd(user.sessionCookie)
    )
    expect(body.dnd.timezone).toBe(TZ)
    expect(body.dnd.is_active).toBe(true)
  })

  it('reports is_active=false for a window the user is outside of in their TZ', async () => {
    const now = new Date()
    const localMin = minutesInZone(now, TZ)
    // A 2-hour window far from local-now (12 hours away), wrapped safely.
    const start = localMin + 360
    const end = localMin + 480
    await setSchedule(user.id, hhmm(start), hhmm(end), TZ)
    const body = await expectSuccess<{ dnd: { is_active: boolean } }>(
      await getDnd(user.sessionCookie)
    )
    expect(body.dnd.is_active).toBe(false)
  })

  it('requires authentication', async () => {
    const res = await getDnd('')
    expect(res.status).toBe(401)
  })
})
