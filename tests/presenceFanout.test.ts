/**
 * `publishPresenceToUserWorkspaces` — workspace-scoped presence fan-out.
 *
 * Pure-unit test: stubs the `getPubSub()` factory and a minimal `pg` Pool so the
 * helper can be exercised without Redis or a database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  // Typed args so `mock.calls[i]` are `[topic, event]` tuples (not empty tuples).
  mockPublish: vi.fn(async (_topic: string, _event: unknown) => {}),
}))

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

import { publishPresenceToUserWorkspaces } from '@/lib/realtime/presenceFanout'
import { presenceTopic, type PubSubEvent } from '@/lib/realtime/redisPubSub'
import type { Pool } from 'pg'

const event: PubSubEvent = { type: 'presence', user_id: 'u-1', status: 'active', last_seen: 1700 }

function poolReturning(workspaceIds: string[]): Pool {
  return {
    query: vi.fn(async () => ({ rows: workspaceIds.map(workspace_id => ({ workspace_id })) })),
  } as unknown as Pool
}

describe('publishPresenceToUserWorkspaces', () => {
  beforeEach(() => {
    m.mockPublish.mockReset()
    m.mockPublish.mockResolvedValue(undefined)
  })

  it('publishes to the workspace-scoped topic of every workspace the user is in', async () => {
    await publishPresenceToUserWorkspaces(poolReturning(['ws-1', 'ws-2']), 'u-1', event)
    expect(m.mockPublish).toHaveBeenCalledTimes(2)
    const topics = m.mockPublish.mock.calls.map(c => c[0]).sort()
    expect(topics).toEqual([presenceTopic('ws-1'), presenceTopic('ws-2')])
    // The scoped topic is never the legacy global one.
    expect(topics).not.toContain('global:presence')
    // The event payload is forwarded verbatim.
    expect(m.mockPublish.mock.calls[0][1]).toMatchObject({ type: 'presence', user_id: 'u-1' })
  })

  it('publishes nothing when the user belongs to no workspace', async () => {
    await publishPresenceToUserWorkspaces(poolReturning([]), 'u-1', event)
    expect(m.mockPublish).not.toHaveBeenCalled()
  })

  it('does not throw when one topic publish fails (best-effort per topic)', async () => {
    m.mockPublish.mockRejectedValueOnce(new Error('redis down')) // first topic fails
    await expect(
      publishPresenceToUserWorkspaces(poolReturning(['ws-1', 'ws-2']), 'u-1', event)
    ).resolves.toBeUndefined()
    // The second topic was still attempted despite the first rejecting.
    expect(m.mockPublish).toHaveBeenCalledTimes(2)
  })
})
