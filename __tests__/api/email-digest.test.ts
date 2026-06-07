/**
 * Integration tests for email-digest collection + worker run + prefs route.
 *
 * SMTP is unconfigured in the test env, so sendEmail no-ops; we assert the
 * collection query, compose payload, watermark advance, and off-user skipping —
 * never actual delivery. Pure compose/scheduling lives in tests/emailDigest.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, ensureSystemWorkspace, asRequest, TestContext } from '../helpers'
import { collectAllDigestItems, collectDigestItems, composeDigest, runEmailDigests } from '@/lib/notifications/emailDigest'
import { GET as getPrefs, PATCH as patchPrefs } from '@/app/api/auth/notification-prefs/route'

let ctx: TestContext
let workspaceId: string
const userIds: string[] = []

async function seedNotification(userId: string, kind: string, title: string, body: string, createdAt: number, readAt = 0) {
  await ctx.pool.query(
    `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, $7, $8)`,
    [randomUUID(), userId, kind, title, body, workspaceId, readAt, createdAt]
  )
}

/** Seed with an EXPLICIT id so a test can control (created_at, id) keyset ordering. */
async function seedNotificationWithId(id: string, userId: string, kind: string, title: string, body: string, createdAt: number, readAt = 0) {
  await ctx.pool.query(
    `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, $7, $8)`,
    [id, userId, kind, title, body, workspaceId, readAt, createdAt]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
  workspaceId = await ensureSystemWorkspace(ctx.pool)
})

afterAll(async () => {
  for (const id of userIds) {
    await ctx.pool.query(`DELETE FROM aaelink.notifications WHERE user_id = $1`, [id])
    await ctx.pool.query(`DELETE FROM aaelink.user_notification_prefs WHERE user_id = $1`, [id])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('collectDigestItems', () => {
  it('returns only unread, since-watermark, digestable kinds, oldest first', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    await seedNotification(u.id, 'mention', 'Mention A', 'older read', 100, 999)   // read → excluded
    await seedNotification(u.id, 'mention', 'Mention B', 'below watermark', 200)    // below watermark → excluded
    await seedNotification(u.id, 'channel_message', 'Chan', 'wrong kind', 600)       // kind not digestable → excluded
    await seedNotification(u.id, 'mention', 'Mention C', 'included 1', 500)
    await seedNotification(u.id, 'dm', 'DM C', 'included 2', 700)

    const items = await collectDigestItems(ctx.pool, u.id, 300)
    expect(items.map(i => i.title)).toEqual(['Mention C', 'DM C'])
    const composed = composeDigest('daily', items)!
    expect(composed.text).toContain('Mention C: included 1')
    expect(composed.text).toContain('DM C: included 2')
  })
})

describe('runEmailDigests', () => {
  it('sends a digest for due users, advances the watermark, and skips off users', async () => {
    const due = await createTestUser(ctx.pool, { role: 'employee' })
    const off = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(due.id, off.id)

    const now = Date.now()
    // due: daily, last SENT 2 days ago → due (cadence gated by last_digest_sent_at).
    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs (user_id, digest_frequency, last_digest_at, last_digest_sent_at, updated_at)
       VALUES ($1, 'daily', $2, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET digest_frequency = 'daily', last_digest_at = $2, last_digest_sent_at = $2, updated_at = $3`,
      [due.id, now - 2 * 86_400_000, now]
    )
    // off: digest off
    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs (user_id, digest_frequency, last_digest_at, last_digest_sent_at, updated_at)
       VALUES ($1, 'off', 0, 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET digest_frequency = 'off', last_digest_at = 0, last_digest_sent_at = 0, updated_at = $2`,
      [off.id, now]
    )

    await seedNotification(due.id, 'mention', 'M1', 'hello', now - 3600_000)
    await seedNotification(off.id, 'mention', 'M2', 'should not be considered', now - 3600_000)

    const res = await runEmailDigests(ctx.pool, now)
    expect(res.considered).toBe(1)        // only the due user
    expect(res.sent).toBe(1)
    expect(res.watermarks_advanced).toBe(1)

    // due user's watermark advanced to the collected item (NOT to now — so backlog
    // overflow survives); cadence timer advanced to now.
    const { rows } = await ctx.pool.query<{ last_digest_at: string; last_digest_sent_at: string }>(
      `SELECT last_digest_at::text, last_digest_sent_at::text FROM aaelink.user_notification_prefs WHERE user_id = $1`, [due.id]
    )
    expect(Number(rows[0].last_digest_at)).toBe(now - 3600_000)
    expect(Number(rows[0].last_digest_sent_at)).toBe(now)

    // off user untouched.
    const { rows: offRows } = await ctx.pool.query<{ last_digest_at: string }>(
      `SELECT last_digest_at::text FROM aaelink.user_notification_prefs WHERE user_id = $1`, [off.id]
    )
    expect(Number(offRows[0].last_digest_at)).toBe(0)
  })

  it('drains a >50 backlog into ONE digest across two runs without skipping any item', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    const now = Date.now()
    // Seed 120 unread mentions, strictly increasing created_at, all above watermark 0.
    const base = now - 10 * 86_400_000
    for (let i = 0; i < 120; i++) {
      await seedNotification(u.id, 'mention', `Backlog ${i}`, `body ${i}`, base + i)
    }
    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs (user_id, digest_frequency, last_digest_at, last_digest_sent_at, updated_at)
       VALUES ($1, 'daily', 0, 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET digest_frequency = 'daily', last_digest_at = 0, last_digest_sent_at = 0, updated_at = $2`,
      [u.id, now]
    )

    // One run drains the whole backlog in a single digest (paged, gap-free).
    const res1 = await runEmailDigests(ctx.pool, now)
    expect(res1.sent).toBe(1)
    const { rows: after1 } = await ctx.pool.query<{ last_digest_at: string }>(
      `SELECT last_digest_at::text FROM aaelink.user_notification_prefs WHERE user_id = $1`, [u.id]
    )
    // Watermark advanced to the newest seeded item — NOT jumped over the middle.
    expect(Number(after1[0].last_digest_at)).toBe(base + 119)

    // A second run on the same backlog has nothing left for THIS user: the
    // watermark already covers every seeded item, so no item is re-summarized and
    // the watermark does not regress. (Other test users may also be due in this
    // shared run, so assert on this user's state rather than the global counter.)
    const later = now + 2 * 86_400_000
    await runEmailDigests(ctx.pool, later)
    const { rows: after2 } = await ctx.pool.query<{ last_digest_at: string }>(
      `SELECT last_digest_at::text FROM aaelink.user_notification_prefs WHERE user_id = $1`, [u.id]
    )
    // Empty run for this user advances the watermark to the run's `now` (=later),
    // confirming nothing from the backlog was left behind to re-send.
    expect(Number(after2[0].last_digest_at)).toBe(later)
  })

  it('advances watermark even when there are no items (empty digest)', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs (user_id, digest_frequency, last_digest_at, last_digest_sent_at, updated_at)
       VALUES ($1, 'daily', $2, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET digest_frequency = 'daily', last_digest_at = $2, last_digest_sent_at = $2, updated_at = $3`,
      [u.id, now - 2 * 86_400_000, now]
    )
    const res = await runEmailDigests(ctx.pool, now)
    expect(res.skipped_empty).toBeGreaterThanOrEqual(1)
    const { rows } = await ctx.pool.query<{ last_digest_at: string }>(
      `SELECT last_digest_at::text FROM aaelink.user_notification_prefs WHERE user_id = $1`, [u.id]
    )
    expect(Number(rows[0].last_digest_at)).toBe(now)
  })
})

describe('runEmailDigests — same-millisecond watermark (migration 042 id companion)', () => {
  it('does not lose a same-ms sibling with a higher id arriving after the first run', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    const now = Date.now()
    const ts = now - 3600_000 // a single shared created_at millisecond

    // Two notifications at the EXACT same created_at, summarized in run 1. Ids are
    // chosen so the watermark advances to the LARGER id ('...aa02').
    await seedNotificationWithId('11111111-1111-1111-1111-aaaaaaaaaa01', u.id, 'mention', 'Tie A', 'first', ts)
    await seedNotificationWithId('11111111-1111-1111-1111-aaaaaaaaaa02', u.id, 'mention', 'Tie B', 'second', ts)

    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs (user_id, digest_frequency, last_digest_at, last_digest_sent_at, updated_at)
       VALUES ($1, 'daily', 0, 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET digest_frequency = 'daily', last_digest_at = 0, last_digest_id = NULL, last_digest_sent_at = 0, updated_at = $2`,
      [u.id, now - 2 * 86_400_000]
    )

    const res1 = await runEmailDigests(ctx.pool, now)
    expect(res1.sent).toBeGreaterThanOrEqual(1)

    // Watermark advanced to the shared ts and the LARGER id; the strict-timestamp
    // fallback alone (created_at > ts) would now skip ANY other row at ts.
    const { rows: w } = await ctx.pool.query<{ last_digest_at: string; last_digest_id: string | null }>(
      `SELECT last_digest_at::text, last_digest_id FROM aaelink.user_notification_prefs WHERE user_id = $1`, [u.id]
    )
    expect(Number(w[0].last_digest_at)).toBe(ts)
    expect(w[0].last_digest_id).toBe('11111111-1111-1111-1111-aaaaaaaaaa02')

    // A THIRD notification lands at the SAME created_at with a higher id ('...aa03').
    // With a single-timestamp watermark and `created_at > ts` it would be lost
    // forever; the (created_at, id) keyset tuple boundary collects it.
    await seedNotificationWithId('11111111-1111-1111-1111-aaaaaaaaaa03', u.id, 'mention', 'Tie C', 'late same-ms', ts)

    // collectAllDigestItems with the persisted (ts, id) companion must see Tie C.
    const collected = await collectAllDigestItems(ctx.pool, u.id, ts, w[0].last_digest_id)
    expect(collected.map(i => i.title)).toContain('Tie C')
    expect(collected.map(i => i.title)).not.toContain('Tie A') // already summarized — not re-collected
    expect(collected.map(i => i.title)).not.toContain('Tie B')

    // And a full second run summarizes Tie C and advances the id companion to it.
    const later = now + 2 * 86_400_000
    await runEmailDigests(ctx.pool, later)
    const { rows: w2 } = await ctx.pool.query<{ last_digest_at: string; last_digest_id: string | null }>(
      `SELECT last_digest_at::text, last_digest_id FROM aaelink.user_notification_prefs WHERE user_id = $1`, [u.id]
    )
    expect(Number(w2[0].last_digest_at)).toBe(ts) // still the shared ms (Math.max keeps it)
    expect(w2[0].last_digest_id).toBe('11111111-1111-1111-1111-aaaaaaaaaa03')
  })

  it('within-run page-boundary same-ms cluster is fully drained, never re-summarized', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)
    const now = Date.now()
    const ts = now - 7200_000
    // 60 notifications (> DIGEST_PAGE_SIZE 50) ALL at the same created_at: the page
    // boundary lands inside a same-ms cluster. The keyset must drain all 60.
    for (let i = 0; i < 60; i++) {
      const idx = String(i).padStart(2, '0')
      await seedNotificationWithId(`22222222-2222-2222-2222-bbbbbbbbbb${idx}`, u.id, 'mention', `Cluster ${i}`, `b${i}`, ts)
    }
    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs (user_id, digest_frequency, last_digest_at, last_digest_sent_at, updated_at)
       VALUES ($1, 'daily', 0, 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET digest_frequency = 'daily', last_digest_at = 0, last_digest_id = NULL, last_digest_sent_at = 0, updated_at = $2`,
      [u.id, now]
    )

    const all = await collectAllDigestItems(ctx.pool, u.id, 0, null)
    expect(all.length).toBe(60) // every same-ms row drained across the 50-row page boundary
    // ascending (created_at, id) order preserved
    expect(all[0].id).toBe('22222222-2222-2222-2222-bbbbbbbbbb00')
    expect(all[59].id).toBe('22222222-2222-2222-2222-bbbbbbbbbb59')
  })
})

describe('notification-prefs route digest_frequency', () => {
  it('GET defaults to off, PATCH sets and validates', async () => {
    const u = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(u.id)

    const g = await getPrefs(asRequest('GET', '/api/auth/notification-prefs', { cookie: u.sessionCookie }) as never)
    expect((await g.json()).digest_frequency).toBe('off')

    const ok = await patchPrefs(asRequest('PATCH', '/api/auth/notification-prefs', {
      cookie: u.sessionCookie, body: { digest_frequency: 'weekly' },
    }) as never)
    expect(ok.status).toBe(200)
    expect((await ok.json()).digest_frequency).toBe('weekly')

    const bad = await patchPrefs(asRequest('PATCH', '/api/auth/notification-prefs', {
      cookie: u.sessionCookie, body: { digest_frequency: 'hourly' },
    }) as never)
    expect(bad.status).toBe(400)
  })
})
