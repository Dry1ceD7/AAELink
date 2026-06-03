/**
 * Integration + unit tests for D7 OAuth scope enforcement + token rotation.
 *
 * Pure helpers (parseScopes, scopeSatisfied) are tested directly; resolve/
 * require/rotate run against a live Postgres. The routes (oauth/introspect,
 * oauth/rotate) are thin session wrappers over these functions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  parseScopes,
  scopeSatisfied,
  resolveOAuthToken,
  requireScope,
  rotateToken,
} from '@/lib/api/oauthScopes'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const tokenIds: string[] = []

async function mkToken(opts: { scope: string; expiresAt?: number; userId?: string }): Promise<string> {
  const id = randomUUID()
  const token = `aaelink_oat_${randomUUID().replace(/-/g, '')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.oauth_tokens (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
     VALUES ($1, $2, 'bot', 'app1', $3, 'ws1', $4, $5, $6)`,
    [id, token, opts.userId ?? owner.id, opts.scope, opts.expiresAt ?? 0, Date.now()]
  )
  tokenIds.push(id)
  return token
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  if (tokenIds.length) await ctx.pool.query(`DELETE FROM aaelink.oauth_tokens WHERE id = ANY($1)`, [tokenIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('parseScopes / scopeSatisfied', () => {
  it('parses space- and comma-separated scopes', () => {
    expect(parseScopes('chat:write  channels:read, users:read')).toEqual(['chat:write', 'channels:read', 'users:read'])
    expect(parseScopes('')).toEqual([])
  })
  it('satisfies exact, admin super-scope, and resource wildcard', () => {
    expect(scopeSatisfied(['chat:write'], 'chat:write')).toBe(true)
    expect(scopeSatisfied(['admin'], 'anything:here')).toBe(true)
    expect(scopeSatisfied(['chat:*'], 'chat:write')).toBe(true)
    expect(scopeSatisfied(['chat:read'], 'chat:write')).toBe(false)
    expect(scopeSatisfied([], 'chat:write')).toBe(false)
  })
})

describe('resolveOAuthToken', () => {
  it('returns null for unknown and a parsed grant for known', async () => {
    expect(await resolveOAuthToken(ctx.pool, 'nope')).toBeNull()
    const tok = await mkToken({ scope: 'chat:write channels:read' })
    const grant = await resolveOAuthToken(ctx.pool, tok)
    expect(grant?.scopes).toEqual(['chat:write', 'channels:read'])
    expect(grant?.token_type).toBe('bot')
  })
})

describe('requireScope', () => {
  it('rejects invalid, expired, and insufficient; accepts satisfied', async () => {
    expect(await requireScope(ctx.pool, 'nope', 'chat:write')).toEqual({ ok: false, code: 'invalid_token' })

    const expired = await mkToken({ scope: 'chat:write', expiresAt: Date.now() - 1000 })
    expect(await requireScope(ctx.pool, expired, 'chat:write')).toEqual({ ok: false, code: 'token_expired' })

    const readOnly = await mkToken({ scope: 'chat:read' })
    expect(await requireScope(ctx.pool, readOnly, 'chat:write')).toEqual({ ok: false, code: 'insufficient_scope' })

    const ok = await mkToken({ scope: 'chat:write' })
    const res = await requireScope(ctx.pool, ok, 'chat:write')
    expect(res.ok).toBe(true)

    const wild = await mkToken({ scope: 'chat:*' })
    expect((await requireScope(ctx.pool, wild, 'chat:write')).ok).toBe(true)
  })
})

describe('rotateToken', () => {
  it('issues a new secret and invalidates the old', async () => {
    expect(await rotateToken(ctx.pool, 'nope')).toEqual({ ok: false, code: 'invalid_token' })

    const tok = await mkToken({ scope: 'chat:write' })
    const rot = await rotateToken(ctx.pool, tok)
    expect(rot.ok).toBe(true)
    if (rot.ok) {
      expect(rot.token).not.toBe(tok)
      expect(await resolveOAuthToken(ctx.pool, tok)).toBeNull()          // old gone
      const grant = await resolveOAuthToken(ctx.pool, rot.token)          // new works
      expect(grant?.scopes).toEqual(['chat:write'])
    }
  })
})
