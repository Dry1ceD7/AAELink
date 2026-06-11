/**
 * Integration tests for /api/channels route
 *
 * Tests:
 *   - GET /api/channels — list channels (requires workspace_id query param)
 *   - POST /api/channels — create channel (requires workspace_id + display_name in body)
 *   - Auth guard (401 without session)
 *   - Channel membership
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let workspaceId: string
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, employee.id)

  // Create a workspace and add admin as member so GET/POST can pass workspace membership check
  workspaceId = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [workspaceId, `test-ws-${workspaceId.slice(0, 8)}`, 'Test WS', admin.id, now]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [workspaceId, admin.id]
  )
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  // Clean up the workspace we created
  if (workspaceId) {
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE workspace_id = $1`, [workspaceId])
    await ctx.pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [workspaceId])
  }
  await ctx.cleanup()
})

describe('GET /api/channels', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const req = asRequest('GET', '/api/channels')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns channel list for authenticated user', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const req = asRequest('GET', '/api/channels', {
      cookie: admin.sessionCookie,
      query: { workspace_id: workspaceId },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ channels: unknown[] }>(res)
    expect(Array.isArray(body.channels)).toBe(true)
  })
})

describe('POST /api/channels', () => {
  it('creates a public channel', async () => {
    const { POST } = await import('@/app/api/channels/route')
    const displayName = `Test Channel ${Date.now()}`
    const req = asRequest('POST', '/api/channels', {
      cookie: admin.sessionCookie,
      body: { workspace_id: workspaceId, display_name: displayName, type: 'O' },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ channel: { id: string; display_name: string } }>(res)
    expect(body.channel.display_name).toBe(displayName)
  })

  it('rejects empty channel name', async () => {
    const { POST } = await import('@/app/api/channels/route')
    const req = asRequest('POST', '/api/channels', {
      cookie: admin.sessionCookie,
      body: { workspace_id: workspaceId, display_name: '', type: 'O' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('Channel membership', () => {
  it('creator is automatically added as member', async () => {
    const channel = await createTestChannel(ctx.pool, admin.id)
    const { rows } = await ctx.pool.query(
      `SELECT * FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channel.id, admin.id]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].role).toBe('admin')
  })
})
