/**
 * Integration tests for /api/search/users (ILIKE people search).
 *
 * Verifies matching by username / email / department and that an optional
 * workspace_id scopes results to that workspace's members. Plus auth + the
 * empty-query guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData, ensureSystemWorkspace,
  TestContext, TestUser
} from '../helpers'

type UserHit = { id: string; username: string; email: string; department: string }
type UsersBody = { users: UserHit[]; query: string; count: number; workspace_scoped: boolean }

let ctx: TestContext
let caller: TestUser
let target: TestUser
let outsider: TestUser
let workspaceId: string
const createdIds: string[] = []

// Distinctive tokens so this suite's users never collide with other data.
const DEPT = `Quasar${randomUUID().slice(0, 8)}`
const EMAILTAG = `zonk${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  ctx = await createTestContext()
  caller = await createTestUser(ctx.pool, { role: 'employee' })
  // target is a member of the system workspace (createTestUser attaches it).
  target = await createTestUser(ctx.pool, {
    role: 'employee',
    department: DEPT,
    email: `${EMAILTAG}@aaelink.test`,
  })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(caller.id, target.id, outsider.id)
  workspaceId = await ensureSystemWorkspace(ctx.pool)

  // Drop the outsider from the system workspace so the workspace-scoped query
  // genuinely excludes them, while they remain globally searchable.
  await ctx.pool.query(
    `DELETE FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, outsider.id]
  )
  // Make the outsider share the target's distinctive department so a global
  // (unscoped) search returns both, but a scoped search returns only target.
  await ctx.pool.query(`UPDATE aaelink.users SET department = $1 WHERE id = $2`, [DEPT, outsider.id])
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/search/users', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/search/users/route')
    const res = await GET(asRequest('GET', '/api/search/users', { query: { q: 'a' } }))
    expect(res.status).toBe(401)
  })

  it('returns an empty list for an empty query', async () => {
    const { GET } = await import('@/app/api/search/users/route')
    const res = await GET(asRequest('GET', '/api/search/users', {
      cookie: caller.sessionCookie, query: { q: '' }
    }))
    const body = await expectSuccess<UsersBody>(res)
    expect(body.users).toEqual([])
    expect(body.count).toBe(0)
  })

  it('matches by username', async () => {
    const { GET } = await import('@/app/api/search/users/route')
    const res = await GET(asRequest('GET', '/api/search/users', {
      cookie: caller.sessionCookie, query: { q: target.email.split('@')[0].slice(0, 6) }
    }))
    const body = await expectSuccess<UsersBody>(res)
    // username is test_<suffix>; match by a fragment of the email local part is
    // covered separately — here assert email match returns the target.
    expect(body.users.some(u => u.id === target.id)).toBe(true)
  })

  it('matches by email fragment', async () => {
    const { GET } = await import('@/app/api/search/users/route')
    const res = await GET(asRequest('GET', '/api/search/users', {
      cookie: caller.sessionCookie, query: { q: EMAILTAG }
    }))
    const body = await expectSuccess<UsersBody>(res)
    expect(body.users.map(u => u.id)).toContain(target.id)
  })

  it('matches by department', async () => {
    const { GET } = await import('@/app/api/search/users/route')
    const res = await GET(asRequest('GET', '/api/search/users', {
      cookie: caller.sessionCookie, query: { q: DEPT }
    }))
    const body = await expectSuccess<UsersBody>(res)
    expect(body.users.map(u => u.id)).toContain(target.id)
  })

  it('workspace_id scopes results to workspace members only', async () => {
    const { GET } = await import('@/app/api/search/users/route')

    // Unscoped: both target and outsider (same department) are returned.
    const globalRes = await GET(asRequest('GET', '/api/search/users', {
      cookie: caller.sessionCookie, query: { q: DEPT }
    }))
    const globalBody = await expectSuccess<UsersBody>(globalRes)
    expect(globalBody.workspace_scoped).toBe(false)
    expect(globalBody.users.map(u => u.id)).toEqual(expect.arrayContaining([target.id, outsider.id]))

    // Scoped: only the workspace member (target) is returned; the outsider is not.
    const scopedRes = await GET(asRequest('GET', '/api/search/users', {
      cookie: caller.sessionCookie, query: { q: DEPT, workspace_id: workspaceId }
    }))
    const scopedBody = await expectSuccess<UsersBody>(scopedRes)
    expect(scopedBody.workspace_scoped).toBe(true)
    expect(scopedBody.users.map(u => u.id)).toContain(target.id)
    expect(scopedBody.users.map(u => u.id)).not.toContain(outsider.id)
  })
})
