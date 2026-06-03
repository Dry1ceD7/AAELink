/**
 * Integration tests for D5 WebRTC signaling relay.
 *
 * Exercises lib/calls/signaling.ts against a live Postgres. The route
 * (app/api/calls/[roomId]/signals) is a thin session + CSRF wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { postSignal, fetchSignals, listRoomParticipants } from '@/lib/calls/signaling'

let ctx: TestContext
let a: TestUser
let b: TestUser
let c: TestUser
let outsider: TestUser
const userIds: string[] = []
const roomIds: string[] = []

async function mkRoom(creator: string, status = 'active'): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.call_rooms
       (id, channel_id, call_type, title, status, recording, screen_share_user_id, max_participants, created_by, created_at, ended_at)
     VALUES ($1, NULL, 'video', 'test', $2, false, '', 50, $3, $4, 0)`,
    [id, status, creator, Date.now()]
  )
  roomIds.push(id)
  return id
}

async function addParticipant(roomId: string, uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.call_participants
       (id, room_id, user_id, role, muted, video_on, screen_sharing, joined_at, left_at)
     VALUES ($1, $2, $3, 'participant', false, false, false, $4, 0)`,
    [randomUUID(), roomId, uid, Date.now()]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
  a = await createTestUser(ctx.pool, { role: 'employee' })
  b = await createTestUser(ctx.pool, { role: 'employee' })
  c = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(a.id, b.id, c.id, outsider.id)
})

afterAll(async () => {
  if (roomIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.call_signals WHERE room_id = ANY($1)`, [roomIds])
    await ctx.pool.query(`DELETE FROM aaelink.call_participants WHERE room_id = ANY($1)`, [roomIds])
    await ctx.pool.query(`DELETE FROM aaelink.call_rooms WHERE id = ANY($1)`, [roomIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('postSignal', () => {
  it('rejects an unknown/ended room', async () => {
    expect(await postSignal(ctx.pool, 'nope', a.id, '', 'offer', {})).toEqual({ ok: false, code: 'room_not_active' })
    const ended = await mkRoom(a.id, 'ended')
    await addParticipant(ended, a.id)
    expect(await postSignal(ctx.pool, ended, a.id, '', 'offer', {})).toEqual({ ok: false, code: 'room_not_active' })
  })

  it('rejects a non-participant and an invalid kind', async () => {
    const room = await mkRoom(a.id)
    await addParticipant(room, a.id)
    expect(await postSignal(ctx.pool, room, outsider.id, '', 'offer', {})).toEqual({ ok: false, code: 'not_participant' })
    expect(await postSignal(ctx.pool, room, a.id, '', 'garbage', {})).toEqual({ ok: false, code: 'invalid_kind' })
  })
})

describe('fetchSignals routing', () => {
  it('delivers directed to the target, broadcast to all-but-sender, never to self', async () => {
    const room = await mkRoom(a.id)
    await addParticipant(room, a.id)
    await addParticipant(room, b.id)
    await addParticipant(room, c.id)

    const directed = await postSignal(ctx.pool, room, a.id, b.id, 'offer', { sdp: 'x' })
    const broadcast = await postSignal(ctx.pool, room, a.id, '', 'ice', { cand: 'y' })
    expect(directed.ok && broadcast.ok).toBe(true)

    const forB = await fetchSignals(ctx.pool, room, b.id)
    const forC = await fetchSignals(ctx.pool, room, c.id)
    const forA = await fetchSignals(ctx.pool, room, a.id)
    if (!forB.ok || !forC.ok || !forA.ok) throw new Error('fetch failed')

    expect(forB.signals.map(s => s.kind)).toEqual(['offer', 'ice']) // directed + broadcast
    expect(forC.signals.map(s => s.kind)).toEqual(['ice'])           // broadcast only
    expect(forA.signals).toEqual([])                                  // never own signals
  })

  it('advances the cursor and returns nothing on re-poll', async () => {
    const room = await mkRoom(a.id)
    await addParticipant(room, a.id)
    await addParticipant(room, b.id)
    await postSignal(ctx.pool, room, a.id, b.id, 'offer', {})
    await postSignal(ctx.pool, room, a.id, b.id, 'ice', {})

    const first = await fetchSignals(ctx.pool, room, b.id, 0)
    if (!first.ok) throw new Error('fetch failed')
    expect(first.signals.length).toBe(2)
    expect(first.cursor).toBeGreaterThan(0)

    const again = await fetchSignals(ctx.pool, room, b.id, first.cursor)
    if (!again.ok) throw new Error('fetch failed')
    expect(again.signals).toEqual([])
    expect(again.cursor).toBe(first.cursor)
  })

  it('rejects a non-participant poll', async () => {
    const room = await mkRoom(a.id)
    await addParticipant(room, a.id)
    expect(await fetchSignals(ctx.pool, room, outsider.id)).toEqual({ ok: false, code: 'not_participant' })
  })
})

describe('listRoomParticipants', () => {
  it('lists active participants only', async () => {
    const room = await mkRoom(a.id)
    await addParticipant(room, a.id)
    await addParticipant(room, b.id)
    await ctx.pool.query(`UPDATE aaelink.call_participants SET left_at = $1 WHERE room_id = $2 AND user_id = $3`,
      [Date.now(), room, b.id])

    const parts = await listRoomParticipants(ctx.pool, room)
    expect(parts.map(p => p.user_id)).toEqual([a.id])
  })
})
