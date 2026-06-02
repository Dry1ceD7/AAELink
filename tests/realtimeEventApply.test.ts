/**
 * Pure helpers `applyTypingEvent` / `applyPresenceEvent` — used by the home
 * shell to route gateway `typing` / `presence` payloads into local state.
 *
 * The helpers themselves live alongside the components in
 * `app/components/chat/realtimeEventApply.ts` so they are unit-testable
 * without mounting the React tree.
 */

import { describe, it, expect } from 'vitest'
import {
  applyTypingEvent,
  applyPresenceEvent,
  type TypingState,
  type PresenceLastSeenMap,
} from '@/components/chat/realtimeEventApply'
import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

describe('applyTypingEvent', () => {
  const emptyState: TypingState = {}

  it('adds the user to the channel typing set on active=true', () => {
    const ev: PubSubEvent = {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-2',
      active: true,
    }
    const out = applyTypingEvent(emptyState, ev, 1000)
    expect(out['ch-1']).toEqual({ 'u-2': 1000 })
  })

  it('removes the user from the channel typing set on active=false', () => {
    const seeded: TypingState = { 'ch-1': { 'u-2': 999, 'u-3': 999 } }
    const ev: PubSubEvent = {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-2',
      active: false,
    }
    const out = applyTypingEvent(seeded, ev, 1000)
    expect(out['ch-1']).toEqual({ 'u-3': 999 })
  })

  it('returns the same reference when nothing changes', () => {
    // Removing a user that was not present is a no-op.
    const seeded: TypingState = { 'ch-1': { 'u-3': 999 } }
    const ev: PubSubEvent = {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-2',
      active: false,
    }
    const out = applyTypingEvent(seeded, ev, 1000)
    expect(out).toBe(seeded)
  })

  it('ignores non-typing events', () => {
    const ev: PubSubEvent = {
      type: 'message',
      channel_id: 'ch-1',
      payload: { id: 'p1' },
    }
    expect(applyTypingEvent(emptyState, ev, 1000)).toBe(emptyState)
  })
})

describe('applyPresenceEvent', () => {
  const emptyMap: PresenceLastSeenMap = {}

  it('records last_seen for the user on a presence event', () => {
    const ev: PubSubEvent = {
      type: 'presence',
      user_id: 'u-1',
      status: 'online',
      last_seen: 1700,
    }
    const out = applyPresenceEvent(emptyMap, ev)
    expect(out['u-1']).toBe(1700)
  })

  it('ignores presence events with an older last_seen', () => {
    const seeded: PresenceLastSeenMap = { 'u-1': 2000 }
    const ev: PubSubEvent = {
      type: 'presence',
      user_id: 'u-1',
      status: 'online',
      last_seen: 1500,
    }
    const out = applyPresenceEvent(seeded, ev)
    expect(out).toBe(seeded)
  })

  it('ignores non-presence events', () => {
    const ev: PubSubEvent = {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    }
    expect(applyPresenceEvent(emptyMap, ev)).toBe(emptyMap)
  })
})
