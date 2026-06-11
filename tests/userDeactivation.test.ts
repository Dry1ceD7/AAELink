/**
 * AAELink — setUserActive (converged user deactivation) tests
 *
 * Verifies the shared deactivation mechanism used by both the admin deactivate
 * endpoint and (by convention) SCIM: flips scim_active and revokes sessions on
 * deactivate, restores scim_active on reactivate, and reports a missing user.
 * Live Postgres pool (integration-style).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  cleanupTestData,
  type TestContext,
  type TestUser,
} from '../__tests__/helpers'
import { setUserActive } from '../lib/auth/userDeactivation'

let ctx: TestContext
const createdIds: string[] = []

async function scimActive(id: string): Promise<boolean | null> {
  const { rows } = await ctx.pool.query<{ scim_active: boolean }>(
    `SELECT scim_active FROM aaelink.users WHERE id = $1`, [id]
  )
  return rows[0]?.scim_active ?? null
}

async function sessionCount(id: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.sessions WHERE user_id = $1`, [id]
  )
  return Number(rows[0]?.n || 0)
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
})

describe('setUserActive', () => {
  it('deactivate flips scim_active false and revokes all sessions', async () => {
    const user: TestUser = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    expect(await scimActive(user.id)).toBe(true)
    expect(await sessionCount(user.id)).toBe(1) // createTestUser seeds one session

    const res = await setUserActive(ctx.pool, user.id, false)
    expect(res.found).toBe(true)
    expect(res.sessionsRevoked).toBe(1)
    expect(await scimActive(user.id)).toBe(false)
    expect(await sessionCount(user.id)).toBe(0)
  })

  it('reactivate flips scim_active true and revokes nothing', async () => {
    const user: TestUser = await createTestUser(ctx.pool)
    createdIds.push(user.id)
    await setUserActive(ctx.pool, user.id, false)

    const res = await setUserActive(ctx.pool, user.id, true)
    expect(res.found).toBe(true)
    expect(res.sessionsRevoked).toBe(0)
    expect(await scimActive(user.id)).toBe(true)
  })

  it('returns found=false for an unknown user', async () => {
    const res = await setUserActive(ctx.pool, randomUUID(), false)
    expect(res.found).toBe(false)
    expect(res.sessionsRevoked).toBe(0)
  })
})
