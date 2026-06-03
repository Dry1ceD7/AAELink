/**
 * Integration tests for /api/calls/rooms
 *
 * Tests:
 *   - GET  — list call rooms
 *   - POST — create a room (returns 201)
 *   - PUT  — join a room (action=join)
 *   - PUT  — leave a room (action=leave)
 *   - Auth guard
 *
 * Note: join/leave are PUT operations, not POST. POST creates a new room (201).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let user: TestUser
let other: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id, other.id)
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

  it('creates a call room (201)', async () => {
    const { POST } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('POST', '/api/calls/rooms', {
      cookie: user.sessionCookie,
      body: {
        call_type: 'voice',
        title: 'Test Huddle Room',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await expectSuccess<{ room: { id: string } }>(res)
    expect(body.room).toHaveProperty('id')
    roomId = body.room.id
  })

  it('joins a call room (PUT action=join)', async () => {
    const { PUT } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie,
      body: {
        action: 'join',
        room_id: roomId,
      },
    })
    const res = await PUT(req)
    // Creator is already in the room (inserted on create), ON CONFLICT DO NOTHING returns 200
    expect(res.status).toBe(200)
  })

  it('leaves a call room (PUT action=leave)', async () => {
    const { PUT } = await import('@/app/api/calls/rooms/route')
    const req = asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie,
      body: {
        action: 'leave',
        room_id: roomId,
      },
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
  })

  it('forbids a non-host participant from ending the room, allows the host', async () => {
    const { POST, PUT } = await import('@/app/api/calls/rooms/route')
    const created = await POST(asRequest('POST', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { call_type: 'voice', title: 'Host Test' },
    }))
    const { room } = await expectSuccess<{ room: { id: string } }>(created)

    // a non-host participant cannot end
    const denied = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: other.sessionCookie, body: { action: 'end', room_id: room.id },
    }))
    expect(denied.status).toBe(403)

    // the host (creator) can
    const ok = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { action: 'end', room_id: room.id },
    }))
    expect(ok.status).toBe(200)
  })
})
