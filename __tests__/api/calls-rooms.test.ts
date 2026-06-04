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
const createdRoomIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  other = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id, other.id)
})

afterAll(async () => {
  // Call rooms created by these users reference them via created_by; remove the
  // rooms (participants cascade) before the user cleanup or the delete is blocked.
  if (createdRoomIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE resource_id = ANY($1)`, [createdRoomIds])
    await ctx.pool.query(`DELETE FROM aaelink.call_participants WHERE room_id = ANY($1)`, [createdRoomIds])
    await ctx.pool.query(`DELETE FROM aaelink.call_rooms WHERE id = ANY($1)`, [createdRoomIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.call_participants WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.call_rooms WHERE created_by = ANY($1)`, [createdIds])
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

  it('double join leaves exactly one active participant row (migration 032 idempotency)', async () => {
    const { POST, PUT } = await import('@/app/api/calls/rooms/route')
    // Create a fresh room (creator is auto-joined as host) with the OTHER user so
    // the row count below is unambiguous and isolated from earlier cases.
    const created = await POST(asRequest('POST', '/api/calls/rooms', {
      cookie: other.sessionCookie, body: { call_type: 'voice', title: 'Dup Join Test' },
    }))
    const { room } = await expectSuccess<{ room: { id: string } }>(created)
    createdRoomIds.push(room.id)

    // A second user joins twice — the partial unique index + ON CONFLICT DO
    // NOTHING must make the re-join a no-op rather than insert a duplicate row.
    const first = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { action: 'join', room_id: room.id },
    }))
    expect(first.status).toBe(200)
    const second = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { action: 'join', room_id: room.id },
    }))
    expect(second.status).toBe(200)

    const { rows } = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM aaelink.call_participants
        WHERE room_id = $1 AND user_id = $2 AND left_at = 0`,
      [room.id, user.id]
    )
    expect(Number(rows[0].n)).toBe(1)
  })

  it('rejects an authenticated mutation without a CSRF token (fail-closed)', async () => {
    const { PUT } = await import('@/app/api/calls/rooms/route')
    const res = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie, noAutoCsrf: true,
      body: { action: 'join', room_id: 'any' },
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error?: string }
    expect(String(body.error || '')).toMatch(/^csrf_/)
  })

  it('ending an already-ended room is a no-op that preserves ended_at (no duplicate audit)', async () => {
    const { POST, PUT } = await import('@/app/api/calls/rooms/route')
    const created = await POST(asRequest('POST', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { call_type: 'voice', title: 'Double End Test' },
    }))
    const { room } = await expectSuccess<{ room: { id: string } }>(created)
    createdRoomIds.push(room.id)

    const first = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { action: 'end', room_id: room.id },
    }))
    const firstBody = await expectSuccess<{ ended_at: number }>(first)

    const second = await PUT(asRequest('PUT', '/api/calls/rooms', {
      cookie: user.sessionCookie, body: { action: 'end', room_id: room.id },
    }))
    expect(second.status).toBe(200)
    const secondBody = await expectSuccess<{ ended_at: number }>(second)
    // ended_at must not be rewritten by the redundant end
    expect(secondBody.ended_at).toBe(firstBody.ended_at)

    // writeAuditLog is fire-and-forget — poll briefly for the row to land,
    // then assert exactly one entry exists despite the double end.
    let auditCount = 0
    for (let i = 0; i < 20; i++) {
      const { rows } = await ctx.pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM aaelink.audit_log
          WHERE action = 'call.end' AND resource_id = $1`, [room.id]
      )
      auditCount = Number(rows[0].n)
      if (auditCount > 0) break
      await new Promise(r => setTimeout(r, 50))
    }
    expect(auditCount).toBe(1)
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
