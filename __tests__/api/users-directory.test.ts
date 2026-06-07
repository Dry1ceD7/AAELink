/**
 * Integration tests for /api/users/directory (Slack users.list parity).
 *
 * Focus: the ?status= filter must agree with the displayed account_status.
 * account_status is COALESCE((SELECT status FROM user_status ...), 'offline'),
 * so a user with NO user_status row is shown as 'offline' and MUST therefore
 * also be matched by ?status=offline. A prior regression filtered on the
 * un-coalesced subquery, silently dropping every user lacking a user_status row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

type Member = { id: string; account_status: string; department: string }
type DirectoryBody = { members: Member[] }

let ctx: TestContext
let caller: TestUser
// noStatus has NO user_status row -> displayed + filtered as 'offline'.
let noStatus: TestUser
// withStatus has an explicit user_status row of 'away'.
let withStatus: TestUser
const createdIds: string[] = []

// Distinctive department so the directory result set is deterministic on a
// shared database; the route filters by ?department_id= (= users.department).
const DEPT = `Pulsar${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  ctx = await createTestContext()
  caller = await createTestUser(ctx.pool, { role: 'employee' })
  noStatus = await createTestUser(ctx.pool, { role: 'employee', department: DEPT })
  withStatus = await createTestUser(ctx.pool, { role: 'employee', department: DEPT })
  createdIds.push(caller.id, noStatus.id, withStatus.id)

  // Give only withStatus an explicit presence row; noStatus deliberately has none.
  await ctx.pool.query(
    `INSERT INTO aaelink.user_status (user_id, status, updated_at)
     VALUES ($1, 'away', $2)
     ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status`,
    [withStatus.id, Date.now()]
  )
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.user_status WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/users/directory status filter', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const res = await GET(asRequest('GET', '/api/users/directory'))
    expect(res.status).toBe(401)
  })

  it('shows a user with no user_status row as account_status "offline"', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const res = await GET(asRequest('GET', '/api/users/directory', {
      cookie: caller.sessionCookie, query: { department_id: DEPT }
    }))
    const body = await expectSuccess<DirectoryBody>(res)
    const row = body.members.find(m => m.id === noStatus.id)
    expect(row).toBeDefined()
    expect(row?.account_status).toBe('offline')
  })

  it('matches a user with NO user_status row when filtering ?status=offline', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const res = await GET(asRequest('GET', '/api/users/directory', {
      cookie: caller.sessionCookie, query: { status: 'offline', department_id: DEPT }
    }))
    const body = await expectSuccess<DirectoryBody>(res)
    const ids = body.members.map(m => m.id)
    // Display and filter must agree: the offline-shown user is returned.
    expect(ids).toContain(noStatus.id)
    // The user whose explicit status is 'away' is NOT an offline match.
    expect(ids).not.toContain(withStatus.id)
  })

  it('matches a user by their explicit user_status value (?status=away)', async () => {
    const { GET } = await import('@/app/api/users/directory/route')
    const res = await GET(asRequest('GET', '/api/users/directory', {
      cookie: caller.sessionCookie, query: { status: 'away', department_id: DEPT }
    }))
    const body = await expectSuccess<DirectoryBody>(res)
    const ids = body.members.map(m => m.id)
    expect(ids).toContain(withStatus.id)
    expect(ids).not.toContain(noStatus.id)
  })
})
