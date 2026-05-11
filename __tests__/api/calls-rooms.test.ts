/**
 * Integration tests for /api/calls/rooms
 *
 * Tests:
 *   - GET  — list call rooms
 *   - POST — create a room
 *   - POST — join a room
 *   - POST — leave a room
 *   - Auth guard
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/calls/rooms', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('GET', '/api/calls/rooms')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns rooms list', async () => {
    const { GET } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('GET', '/api/calls/rooms', { cookie: user.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ rooms: unknown[] }>(res)
    expect(body).toHaveProperty('rooms')
    expect(Array.isArray(body.rooms)).toBe(true)
  })
})

describe('POST /api/calls/rooms', () => {
  let roomId: string

  it('creates a call room', async () => {
    const { POST } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('POST', '/api/calls/rooms', {
      cookie: user.sessionCookie,
      body: {
        action: 'create',
        name: 'Test Huddle Room',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ room: { id: string } }>(res)
    expect(body.room).toHaveProperty('id')
    roomId = body.room.id
  })

  it('joins a call room', async () => {
    const { POST } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('POST', '/api/calls/rooms', {
      cookie: user.sessionCookie,
      body: {
        action: 'join',
        room_id: roomId,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('leaves a call room', async () => {
    const { POST } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('POST', '/api/calls/rooms', {
      cookie: user.sessionCookie,
      body: {
        action: 'leave',
        room_id: roomId,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
