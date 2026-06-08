/**
 * `app/api/collab/presence` POST emits a `presence` PubSubEvent on the
 * `global:presence` topic — consumed by the WS gateway after v0.0.43.
 *
 * Pure-unit test mirroring `tests/collabTypingEmit.test.ts`. Stubs
 * `lib/db.getPool`, `lib/session.readSessionUserId`, `lib/migrate.ensureSchema`,
 * the `getPubSub()` factory, and bypasses the `tracedRoute` wrapper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const mockQuery = vi.fn(async (_sql: string, _args?: unknown[]) => ({ rows: [] as Record<string, unknown>[] }))
  const mockPool = { query: mockQuery }
  const mockPublish = vi.fn()
  const mockEnsureSchema = vi.fn(async () => {})
  const mockReadSessionUserId = vi.fn(async () => 'u-1')
  return { mockQuery, mockPool, mockPublish, mockEnsureSchema, mockReadSessionUserId }
})

vi.mock('@/lib/infra/db', () => ({ getPool: () => m.mockPool }))
vi.mock('@/lib/infra/migrate', () => ({ ensureSchema: m.mockEnsureSchema }))
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
vi.mock('@/lib/api/tracedRoute', () => ({
  tracedRoute: (_method: string, _path: string, handler: unknown) => handler,
}))

import { POST } from '@/app/api/collab/presence/route'
import { presenceTopic } from '@/lib/realtime/redisPubSub'

describe('POST /api/collab/presence — emits on the workspace presence topic', () => {
  beforeEach(() => {
    m.mockQuery.mockReset()
    m.mockPublish.mockReset()
    m.mockReadSessionUserId.mockReset()
    m.mockEnsureSchema.mockReset()
    m.mockReadSessionUserId.mockResolvedValue('u-1')
    m.mockEnsureSchema.mockResolvedValue(undefined)
    // workspace_members lookup drives the presence fan-out targets; everything
    // else (last_seen update, presence-payload resolve) returns no rows.
    m.mockQuery.mockImplementation(async (sql: string) =>
      typeof sql === 'string' && sql.includes('workspace_members')
        ? { rows: [{ workspace_id: 'ws-1' }] }
        : { rows: [] }
    )
  })

  function callPost(): Promise<Response> {
    const fn = POST as unknown as () => Promise<Response>
    return fn()
  }

  it('emits a presence event on the workspace presence topic', async () => {
    const res = await callPost()
    expect(res.status).toBe(200)
    expect(m.mockPublish).toHaveBeenCalledOnce()
    const [topic, event] = m.mockPublish.mock.calls[0]
    expect(topic).toBe(presenceTopic('ws-1'))
    expect(event).toMatchObject({
      type: 'presence',
      user_id: 'u-1',
      // Presence fan-out derives the canonical Presence vocabulary (active/away/
      // dnd/offline); a heartbeating user with no manual status resolves to active.
      status: 'active',
    })
    expect(typeof (event as { last_seen: number }).last_seen).toBe('number')
  })

  it('still updates aaelink.users last_seen_at (DB regression)', async () => {
    await callPost()
    const updateCall = m.mockQuery.mock.calls.find((args) => {
      const sql = args[0]
      return typeof sql === 'string' && sql.includes('UPDATE aaelink.users SET last_seen_at')
    })
    expect(updateCall).toBeDefined()
  })

  it('does not throw when publish fails (Redis outage simulated)', async () => {
    m.mockPublish.mockRejectedValueOnce(new Error('redis down'))
    const res = await callPost()
    expect(res.status).toBe(200)
  })
})
