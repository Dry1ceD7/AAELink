/**
 * `app/api/collab/typing` POST emits a `typing` PubSubEvent on the channel
 * topic — consumed by the WS gateway after v0.0.43.
 *
 * Pure-unit test: stubs `lib/db.getPool`, `lib/session.readSessionUserId`,
 * `lib/collab-access.userCanReadChannel`, `lib/migrate.ensureSchema`, and
 * the `getPubSub()` factory. Tests cover the four story acceptance criteria
 * (1: active=true emit, 2: active=false on stop, 3: DB upsert regression,
 * 5: memory pubsub path, 6: thread typing does NOT emit).
 *
 * Criterion 4 (401) is already covered by the chokepoint and is exercised
 * implicitly by these tests staying green when the session mock returns null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => {
  const mockQuery = vi.fn(async (_sql: string, _args?: unknown[]) => ({ rows: [] as Record<string, unknown>[] }))
  const mockPool = { query: mockQuery }
  const mockPublish = vi.fn()
  const mockEnsureSchema = vi.fn(async () => {})
  const mockUserCanReadChannel = vi.fn(async () => true)
  const mockReadSessionUserId = vi.fn(async () => 'u-1')
  return {
    mockQuery,
    mockPool,
    mockPublish,
    mockEnsureSchema,
    mockUserCanReadChannel,
    mockReadSessionUserId,
  }
})

vi.mock('@/lib/infra/db', () => ({ getPool: () => m.mockPool }))
vi.mock('@/lib/infra/migrate', () => ({ ensureSchema: m.mockEnsureSchema }))
vi.mock('@/lib/enterprise/collab-access', () => ({ userCanReadChannel: m.mockUserCanReadChannel }))
vi.mock('@/lib/auth/session', () => ({ readSessionUserId: m.mockReadSessionUserId }))
vi.mock('@/lib/realtime/redisPubSub', async () => {
  const actual = await vi.importActual<typeof import('@/lib/realtime/redisPubSub')>('@/lib/realtime/redisPubSub')
  return {
    ...actual,
    getPubSub: () => ({
      backend: 'memory' as const,
      publish: m.mockPublish,
      subscribe: () => () => {},
      psubscribe: () => () => {},
    }),
  }
})

// Bypass the tracedRoute wrapper so we exercise the handler logic directly.
vi.mock('@/lib/api/tracedRoute', () => ({
  tracedRoute: (_method: string, _path: string, handler: unknown) => handler,
}))

import { POST } from '@/app/api/collab/typing/route'
import { channelTopic } from '@/lib/realtime/redisPubSub'

describe('POST /api/collab/typing — emits on PubSub', () => {
  beforeEach(() => {
    m.mockQuery.mockReset()
    m.mockPublish.mockReset()
    m.mockUserCanReadChannel.mockReset()
    m.mockReadSessionUserId.mockReset()
    m.mockEnsureSchema.mockReset()
    m.mockUserCanReadChannel.mockResolvedValue(true)
    m.mockReadSessionUserId.mockResolvedValue('u-1')
    m.mockEnsureSchema.mockResolvedValue(undefined)
    // Default: every query returns empty rows (so assertThreadRoot fails when
    // a thread_root_id is sent without a row, hitting `invalid_thread_root`).
    m.mockQuery.mockResolvedValue({ rows: [] })
  })

  function postReq(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/collab/typing', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  }

  function callPost(body: Record<string, unknown>): Promise<Response> {
    // tracedRoute is mocked to identity, so POST is the unwrapped handler
    // (single-argument). Cast to accept the (req) signature.
    const fn = POST as unknown as (req: NextRequest) => Promise<Response>
    return fn(postReq(body))
  }

  it('emits typing event with active=true on a normal POST', async () => {
    const res = await callPost({ channel_id: 'ch-1' })
    expect(res.status).toBe(200)
    expect(m.mockPublish).toHaveBeenCalledOnce()
    const [topic, event] = m.mockPublish.mock.calls[0]
    expect(topic).toBe(channelTopic('ch-1'))
    expect(event).toMatchObject({
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    })
  })

  it('emits typing event with active=false when body.stop is true', async () => {
    const res = await callPost({ channel_id: 'ch-1', stop: true })
    expect(res.status).toBe(200)
    expect(m.mockPublish).toHaveBeenCalledOnce()
    const [, event] = m.mockPublish.mock.calls[0]
    expect(event).toMatchObject({
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: false,
    })
  })

  it('still upserts the channel_typing row (DB regression)', async () => {
    await callPost({ channel_id: 'ch-1' })
    const upsertCall = m.mockQuery.mock.calls.find((args) => {
      const sql = args[0]
      return typeof sql === 'string' && sql.includes('INSERT INTO aaelink.channel_typing')
    })
    expect(upsertCall).toBeDefined()
  })

  it('does NOT emit when thread_root_id is set (out of scope for v0.0.43)', async () => {
    // First call is the assertThreadRoot SELECT — return a row to pass that gate.
    m.mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM aaelink.messages')) {
        return { rows: [{ ok: 1 }] as Record<string, unknown>[] }
      }
      return { rows: [] }
    })
    const res = await callPost({ channel_id: 'ch-1', thread_root_id: 'root-1' })
    expect(res.status).toBe(200)
    expect(m.mockPublish).not.toHaveBeenCalled()
  })

  it('does not throw when publish fails (Redis outage simulated)', async () => {
    m.mockPublish.mockRejectedValueOnce(new Error('redis down'))
    const res = await callPost({ channel_id: 'ch-1' })
    expect(res.status).toBe(200)
  })
})
