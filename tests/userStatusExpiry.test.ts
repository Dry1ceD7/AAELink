/**
 * AAELink — custom-status expiry sweep tests (Slice 6).
 *
 * Verifies the worker heartbeat body (clearExpiredStatuses, lib/notifications/
 * userStatusExpiry.ts): a custom status that is expired AND not 'online' is
 * cleared (users.status_text/status_emoji blanked, user_status.expires_at reset
 * to 0) and its user_id returned; an unexpired status, a no-expiry status, and an
 * expired-but-'online' status are all left untouched; and a re-run is idempotent
 * (clears nothing already handled). Live Postgres pool (integration-style),
 * mirroring tests/guestAccounts.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext,
  createTestUser,
  cleanupTestData,
  type TestContext,
  type TestUser,
} from '../__tests__/helpers'
import { clearExpiredStatuses } from '../lib/notifications/userStatusExpiry'

let ctx: TestContext
const createdIds: string[] = []

/** Seed users.status_* and the user_status row for `userId`. */
async function seedStatus(
  userId: string,
  opts: { status: string; statusText: string; statusEmoji: string; expiresAt: number }
): Promise<void> {
  const now = Date.now()
  await ctx.pool.query(
    `UPDATE aaelink.users SET status_text = $2, status_emoji = $3 WHERE id = $1`,
    [userId, opts.statusText, opts.statusEmoji]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.user_status (user_id, status, custom_text, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       status = $2, custom_text = $3, updated_at = $4, expires_at = $5`,
    [userId, opts.status, opts.statusText, now, opts.expiresAt]
  )
}

async function readStatus(
  userId: string
): Promise<{ statusText: string | null; statusEmoji: string | null; expiresAt: number; status: string }> {
  const { rows: u } = await ctx.pool.query<{ status_text: string | null; status_emoji: string | null }>(
    `SELECT status_text, status_emoji FROM aaelink.users WHERE id = $1`,
    [userId]
  )
  const { rows: s } = await ctx.pool.query<{ expires_at: string; status: string }>(
    `SELECT expires_at, status FROM aaelink.user_status WHERE user_id = $1`,
    [userId]
  )
  return {
    statusText: u[0]?.status_text ?? null,
    statusEmoji: u[0]?.status_emoji ?? null,
    expiresAt: Number(s[0]?.expires_at ?? 0),
    status: s[0]?.status ?? '',
  }
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  for (const id of createdIds) {
    await ctx.pool.query(`DELETE FROM aaelink.user_status WHERE user_id = $1`, [id]).catch(() => {})
  }
  await cleanupTestData(ctx.pool, createdIds)
})

describe('clearExpiredStatuses', () => {
  it('clears an expired, non-online status: profile blanked + expires_at reset', async () => {
    const now = Date.now()
    const user: TestUser = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    await seedStatus(user.id, {
      status: 'away', statusText: 'Out sick', statusEmoji: '🤒', expiresAt: now - 5000,
    })

    const cleared = await clearExpiredStatuses(ctx.pool, now)
    expect(cleared).toContain(user.id)

    const after = await readStatus(user.id)
    expect(after.statusText ?? '').toBe('')
    expect(after.statusEmoji ?? '').toBe('')
    expect(after.expiresAt).toBe(0)
  })

  it('leaves an unexpired status untouched', async () => {
    const now = Date.now()
    const user = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    await seedStatus(user.id, {
      status: 'away', statusText: 'In a meeting', statusEmoji: '📅', expiresAt: now + 60 * 60_000,
    })

    const cleared = await clearExpiredStatuses(ctx.pool, now)
    expect(cleared).not.toContain(user.id)

    const after = await readStatus(user.id)
    expect(after.statusText).toBe('In a meeting')
    expect(after.expiresAt).toBe(now + 60 * 60_000)
  })

  it('leaves a no-expiry status (expires_at = 0) untouched', async () => {
    const now = Date.now()
    const user = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    await seedStatus(user.id, {
      status: 'dnd', statusText: 'Focusing', statusEmoji: '🔇', expiresAt: 0,
    })

    const cleared = await clearExpiredStatuses(ctx.pool, now)
    expect(cleared).not.toContain(user.id)

    const after = await readStatus(user.id)
    expect(after.statusText).toBe('Focusing')
    expect(after.expiresAt).toBe(0)
  })

  it("leaves an expired status that is still 'online' untouched", async () => {
    const now = Date.now()
    const user = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    await seedStatus(user.id, {
      status: 'online', statusText: 'Commuting', statusEmoji: '🚌', expiresAt: now - 5000,
    })

    const cleared = await clearExpiredStatuses(ctx.pool, now)
    expect(cleared).not.toContain(user.id)

    const after = await readStatus(user.id)
    expect(after.statusText).toBe('Commuting')
    expect(after.expiresAt).toBe(now - 5000)
  })

  it('is idempotent: a re-run clears nothing already handled', async () => {
    const now = Date.now()
    const user = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    await seedStatus(user.id, {
      status: 'away', statusText: 'Vacationing', statusEmoji: '🌴', expiresAt: now - 5000,
    })

    const first = await clearExpiredStatuses(ctx.pool, now)
    expect(first).toContain(user.id)

    const second = await clearExpiredStatuses(ctx.pool, now)
    expect(second).not.toContain(user.id)
  })
})
