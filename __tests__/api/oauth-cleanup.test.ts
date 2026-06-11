/**
 * Integration tests for the OAuth store prune (lib/auth/oauthCleanup.ts), the
 * one piece of new logic behind the worker's `oauth_token_cleanup` handler.
 *
 * The worker's `handlers` map is module-local/not exported, so the prune SQL is
 * exercised here directly against live Postgres, seeding authorization codes in
 * four lifecycle states and asserting EXACTLY the expired and the long-consumed
 * rows are removed while live and recently-consumed rows survive. This is the
 * regression the worker.test.ts backoff/registry suite cannot catch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, randomBytes } from 'crypto'
import { createTestContext, TestContext } from '../helpers'
import {
  pruneOAuthCodes,
  pruneExpiredOAuthTokens,
  CONSUMED_CODE_RETENTION_MS,
} from '@/lib/auth/oauthCleanup'

let ctx: TestContext
const codeIds: string[] = []
const tokenIds: string[] = []

async function seedCode(opts: { expiresAt: number; usedAt: number | null }): Promise<string> {
  const id = randomUUID()
  const code = `code_${randomBytes(8).toString('hex')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.oauth_codes
       (id, code, app_id, client_id, user_id, workspace_id, redirect_uri, scope, expires_at, used_at, created_at)
     VALUES ($1, $2, 'app1', 'client1', 'user1', 'ws1', 'https://x/cb', '', $3, $4, $5)`,
    [id, code, opts.expiresAt, opts.usedAt, Date.now()],
  )
  codeIds.push(id)
  return id
}

async function codeExists(id: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.oauth_codes WHERE id = $1`, [id])
  return rows.length > 0
}

async function seedToken(expiresAt: number): Promise<string> {
  const id = randomUUID()
  const token = `tok_${randomBytes(8).toString('hex')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.oauth_tokens
       (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
     VALUES ($1, $2, 'user', 'app1', 'user1', 'ws1', '', $3, $4)`,
    [id, token, expiresAt, Date.now()],
  )
  tokenIds.push(id)
  return id
}

async function tokenExists(id: string): Promise<boolean> {
  const { rows } = await ctx.pool.query(`SELECT 1 FROM aaelink.oauth_tokens WHERE id = $1`, [id])
  return rows.length > 0
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  if (codeIds.length) await ctx.pool.query(`DELETE FROM aaelink.oauth_codes WHERE id = ANY($1)`, [codeIds])
  if (tokenIds.length) await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE id = ANY($1)`, [tokenIds])
})

describe('pruneOAuthCodes', () => {
  it('removes expired and long-consumed codes, keeps live and recently-consumed', async () => {
    const now = Date.now()

    // (1) live, unconsumed — must SURVIVE.
    const live = await seedCode({ expiresAt: now + 60_000, usedAt: null })
    // (2) expired, unconsumed — must be PRUNED.
    const expired = await seedCode({ expiresAt: now - 1_000, usedAt: null })
    // (3) consumed recently (within retention), still unexpired — must SURVIVE.
    const consumedRecent = await seedCode({ expiresAt: now + 60_000, usedAt: now - 1_000 })
    // (4) consumed long ago (> retention), still unexpired — must be PRUNED.
    const consumedOld = await seedCode({
      expiresAt: now + 60_000,
      usedAt: now - CONSUMED_CODE_RETENTION_MS - 1_000,
    })

    const removed = await pruneOAuthCodes(ctx.pool, now)
    expect(removed).toBeGreaterThanOrEqual(2)

    expect(await codeExists(live)).toBe(true)
    expect(await codeExists(consumedRecent)).toBe(true)
    expect(await codeExists(expired)).toBe(false)
    expect(await codeExists(consumedOld)).toBe(false)
  })

  it('treats a code consumed exactly at the retention boundary as still retained', async () => {
    const now = Date.now()
    // used_at === cutoff is NOT < cutoff, so it must survive (predicate uses <).
    const atBoundary = await seedCode({
      expiresAt: now + 60_000,
      usedAt: now - CONSUMED_CODE_RETENTION_MS,
    })
    await pruneOAuthCodes(ctx.pool, now)
    expect(await codeExists(atBoundary)).toBe(true)
  })
})

describe('pruneExpiredOAuthTokens', () => {
  it('removes finite-expiry tokens past expiry, keeps live and never-expiring (0) tokens', async () => {
    const now = Date.now()
    const live = await seedToken(now + 60_000)
    const expired = await seedToken(now - 1_000)
    const neverExpires = await seedToken(0) // sentinel: 0 = never expires

    const removed = await pruneExpiredOAuthTokens(ctx.pool, now)
    expect(removed).toBeGreaterThanOrEqual(1)

    expect(await tokenExists(live)).toBe(true)
    expect(await tokenExists(neverExpires)).toBe(true)
    expect(await tokenExists(expired)).toBe(false)
  })
})
