/**
 * AAELink — MFA backup-code consume tests.
 *
 * Verifies hashBackupCode matches the enrollment generator byte-for-byte, and
 * that consumeBackupCode burns a code single-use (reuse rejected), rejects wrong
 * codes, decrements the remaining count, and is race-safe via the secret_hash
 * guard. Uses a live Postgres pool (same pattern as __tests__/api/ files).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import {
  createTestContext,
  createTestUser,
  cleanupTestData,
  type TestContext,
  type TestUser,
} from '../__tests__/helpers'
import { hashBackupCode, consumeBackupCode } from '../lib/auth/backupCodes'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

// The 10 plaintext codes; same shape the route generates (XXXX-XXXX uppercase).
const codes = Array.from({ length: 10 }, () =>
  `${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase()
)

async function seedBackupCodes(userId: string): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.mfa_enrollments
       (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
     VALUES ($1, $2, 'backup_codes', $3, true, true, $4, 0)`,
    [id, userId, JSON.stringify(codes.map((c) => hashBackupCode(c))), Date.now()]
  )
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.mfa_enrollments WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('hashBackupCode', () => {
  it('matches the enrollment generator scheme exactly', () => {
    const code = 'ABCD-1234'
    const expected = createHmac('sha256', 'backup').update(code).digest('hex').slice(0, 16)
    expect(hashBackupCode(code)).toBe(expected)
    expect(hashBackupCode(code)).toHaveLength(16)
  })
})

describe('consumeBackupCode', () => {
  it('accepts a valid code once and reports remaining count', async () => {
    await seedBackupCodes(user.id)

    const r1 = await consumeBackupCode(ctx.pool, user.id, codes[0])
    expect(r1.consumed).toBe(true)
    expect(r1.remaining).toBe(9)
  })

  it('rejects reuse of an already-consumed code', async () => {
    const r2 = await consumeBackupCode(ctx.pool, user.id, codes[0])
    expect(r2.consumed).toBe(false)
    expect(r2.remaining).toBe(0)
  })

  it('still accepts a different, unused code', async () => {
    const r3 = await consumeBackupCode(ctx.pool, user.id, codes[1])
    expect(r3.consumed).toBe(true)
    expect(r3.remaining).toBe(8)
  })

  it('rejects a wrong / non-existent code', async () => {
    const r = await consumeBackupCode(ctx.pool, user.id, 'ZZZZ-ZZZZ')
    expect(r.consumed).toBe(false)
    expect(r.remaining).toBe(0)
  })

  it('is case-insensitive on input (codes are uppercase)', async () => {
    const r = await consumeBackupCode(ctx.pool, user.id, codes[2].toLowerCase())
    expect(r.consumed).toBe(true)
    expect(r.remaining).toBe(7)
  })

  it('burns exactly one code under concurrent reuse (race guard)', async () => {
    const target = codes[3]
    const [a, b] = await Promise.all([
      consumeBackupCode(ctx.pool, user.id, target),
      consumeBackupCode(ctx.pool, user.id, target),
    ])
    const consumedCount = [a, b].filter((x) => x.consumed).length
    expect(consumedCount).toBe(1)
  })
})
