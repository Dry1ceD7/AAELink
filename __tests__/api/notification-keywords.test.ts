/**
 * Integration + unit tests for D11 keyword notifications.
 *
 * normalizeKeyword / matchKeywords are pure; CRUD runs against a live Postgres.
 * The route (app/api/notifications/keywords) is a thin session + CSRF wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { normalizeKeyword, matchKeywords, addKeyword, removeKeyword, listKeywords } from '@/lib/notifications/keywords'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.notification_keywords WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('normalizeKeyword', () => {
  it('trims, lowercases, collapses whitespace', () => {
    expect(normalizeKeyword('  Deploy  Now ')).toBe('deploy now')
    expect(normalizeKeyword('')).toBe('')
  })
})

describe('matchKeywords', () => {
  it('matches whole words case-insensitively, not substrings', () => {
    expect(matchKeywords('Time to DEPLOY the build', ['deploy'])).toEqual(['deploy'])
    expect(matchKeywords('a redeployment happened', ['deploy'])).toEqual([]) // substring, no match
    expect(matchKeywords('ship it', ['deploy', 'ship'])).toEqual(['ship'])
    expect(matchKeywords('release the kraken now', ['release the kraken'])).toEqual(['release the kraken']) // phrase
  })
  it('handles regex-special keywords and empties', () => {
    expect(matchKeywords('cost is $5 today', ['$5'])).toEqual(['$5'])
    expect(matchKeywords('', ['x'])).toEqual([])
    expect(matchKeywords('text', [])).toEqual([])
  })
})

describe('keyword CRUD', () => {
  it('adds (normalized, idempotent), lists, removes', async () => {
    expect(await addKeyword(ctx.pool, user.id, '  Incident ')).toEqual({ ok: true, keyword: 'incident' })
    expect(await addKeyword(ctx.pool, user.id, 'incident')).toEqual({ ok: true, keyword: 'incident' }) // idempotent
    await addKeyword(ctx.pool, user.id, 'outage')

    expect(await listKeywords(ctx.pool, user.id)).toEqual(['incident', 'outage']) // alphabetical

    expect(await removeKeyword(ctx.pool, user.id, 'INCIDENT')).toBe(true) // normalized on delete
    expect(await removeKeyword(ctx.pool, user.id, 'incident')).toBe(false)
    expect(await listKeywords(ctx.pool, user.id)).toEqual(['outage'])
  })

  it('rejects empty and overly long keywords', async () => {
    expect(await addKeyword(ctx.pool, user.id, '   ')).toEqual({ ok: false, code: 'invalid' })
    expect(await addKeyword(ctx.pool, user.id, 'x'.repeat(101))).toEqual({ ok: false, code: 'too_long' })
  })
})
