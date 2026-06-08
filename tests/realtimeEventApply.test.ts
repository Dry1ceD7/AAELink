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
  applyReadReceiptEvent,
  applyReadReceiptMap,
  isMessageReadEvent,
  routeChannelUpdate,
  type TypingState,
  type PresenceLastSeenMap,
} from '@/components/chat/realtimeEventApply'
import type { PubSubEvent } from '@/lib/realtime/redisPubSub'
import type { ChatPost, MessageReadEvent } from '@/lib/realtime/realtime'

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

describe('isMessageReadEvent', () => {
  it('accepts a well-formed message_read payload', () => {
    const ev: MessageReadEvent = {
      type: 'message_read',
      channel_id: 'ch-1',
      message_id: 'm-1',
      user_id: 'u-2',
      read_at: 1700,
    }
    expect(isMessageReadEvent(ev)).toBe(true)
  })

  it('rejects other event types and malformed shapes', () => {
    expect(isMessageReadEvent({ type: 'channel_update', channel_id: 'ch-1', payload: {} })).toBe(false)
    expect(isMessageReadEvent({ type: 'message_read', message_id: 'm-1' })).toBe(false)
    expect(isMessageReadEvent({ type: 'message_read', channel_id: 'ch-1', message_id: 'm-1', user_id: 'u-2', read_at: '1700' })).toBe(false)
    expect(isMessageReadEvent(null)).toBe(false)
    expect(isMessageReadEvent('message_read')).toBe(false)
  })
})

describe('applyReadReceiptEvent', () => {
  const post = (id: string, receipts?: ChatPost['read_receipts']): ChatPost => ({
    id,
    channel_id: 'ch-1',
    user_id: 'author',
    message: 'hi',
    create_at: 1000,
    ...(receipts ? { read_receipts: receipts } : {}),
  })
  const ev = (overrides: Partial<MessageReadEvent> = {}): MessageReadEvent => ({
    type: 'message_read',
    channel_id: 'ch-1',
    message_id: 'm-1',
    user_id: 'u-2',
    read_at: 1700,
    ...overrides,
  })

  it('adds the reader to a post that had no receipts', () => {
    const posts = [post('m-1')]
    const out = applyReadReceiptEvent(posts, ev())
    expect(out).not.toBe(posts)
    expect(out[0].read_receipts).toEqual([{ user_id: 'u-2', read_at: 1700 }])
  })

  it('merges a new reader, newest-first, mirroring server order', () => {
    const posts = [post('m-1', [{ user_id: 'u-3', read_at: 1500 }])]
    const out = applyReadReceiptEvent(posts, ev({ user_id: 'u-2', read_at: 1700 }))
    expect(out[0].read_receipts).toEqual([
      { user_id: 'u-2', read_at: 1700 },
      { user_id: 'u-3', read_at: 1500 },
    ])
  })

  it('caps the stack at 5 readers, dropping the oldest', () => {
    const seeded = [
      { user_id: 'a', read_at: 1600 },
      { user_id: 'b', read_at: 1500 },
      { user_id: 'c', read_at: 1400 },
      { user_id: 'd', read_at: 1300 },
      { user_id: 'e', read_at: 1200 },
    ]
    const out = applyReadReceiptEvent([post('m-1', seeded)], ev({ user_id: 'z', read_at: 1700 }))
    const ids = out[0].read_receipts!.map(r => r.user_id)
    expect(ids).toEqual(['z', 'a', 'b', 'c', 'd'])
    expect(out[0].read_receipts).toHaveLength(5)
  })

  it('is a no-op when the reader is already recorded at an equal-or-earlier time', () => {
    const posts = [post('m-1', [{ user_id: 'u-2', read_at: 1700 }])]
    const out = applyReadReceiptEvent(posts, ev({ user_id: 'u-2', read_at: 1800 }))
    expect(out).toBe(posts)
  })

  it('adopts an earlier read_at for an already-recorded reader (first-sight wins) and re-sorts', () => {
    // Out-of-order fan-out: u-2 is already in the stack at 1700 but an earlier
    // read (1500) arrives. The server keeps first sight, so the client must too —
    // Math.min(1700, 1500) = 1500 — and re-sort (u-3@1600 is now the newest).
    const posts = [post('m-1', [
      { user_id: 'u-2', read_at: 1700 },
      { user_id: 'u-3', read_at: 1600 },
    ])]
    const out = applyReadReceiptEvent(posts, ev({ user_id: 'u-2', read_at: 1500 }))
    expect(out).not.toBe(posts)
    expect(out[0].read_receipts).toEqual([
      { user_id: 'u-3', read_at: 1600 },
      { user_id: 'u-2', read_at: 1500 },
    ])
  })

  it('returns the same array reference when the post is not loaded', () => {
    const posts = [post('m-other')]
    expect(applyReadReceiptEvent(posts, ev({ message_id: 'm-1' }))).toBe(posts)
  })

  it('does not mutate the input posts or receipt arrays', () => {
    const seeded = [{ user_id: 'u-3', read_at: 1500 }]
    const posts = [post('m-1', seeded)]
    applyReadReceiptEvent(posts, ev())
    expect(seeded).toEqual([{ user_id: 'u-3', read_at: 1500 }])
    expect(posts[0].read_receipts).toBe(seeded)
  })
})

describe('applyReadReceiptMap', () => {
  const post = (id: string, receipts?: ChatPost['read_receipts']): ChatPost => ({
    id,
    channel_id: 'ch-1',
    user_id: 'author',
    message: 'hi',
    create_at: 1000,
    ...(receipts ? { read_receipts: receipts } : {}),
  })

  it('replaces a loaded post stack with the server-authoritative list', () => {
    const posts = [post('m-1', [{ user_id: 'u-3', read_at: 1500 }]), post('m-2')]
    const out = applyReadReceiptMap(posts, {
      'm-1': [{ user_id: 'u-2', read_at: 1700 }, { user_id: 'u-3', read_at: 1500 }],
    })
    expect(out).not.toBe(posts)
    expect(out[0].read_receipts).toEqual([
      { user_id: 'u-2', read_at: 1700 },
      { user_id: 'u-3', read_at: 1500 },
    ])
    expect(out[1]).toBe(posts[1]) // untouched post keeps its reference
  })

  it('is a no-op (same reference) when nothing in the map matches loaded posts', () => {
    const posts = [post('m-1')]
    expect(applyReadReceiptMap(posts, { 'm-other': [{ user_id: 'u-2', read_at: 1700 }] })).toBe(posts)
  })

  it('is a no-op when the incoming stack equals the current stack', () => {
    const same = [{ user_id: 'u-2', read_at: 1700 }]
    const posts = [post('m-1', same)]
    expect(applyReadReceiptMap(posts, { 'm-1': [{ user_id: 'u-2', read_at: 1700 }] })).toBe(posts)
  })
})

describe('routeChannelUpdate', () => {
  it('routes a valid inner message_read payload to a read_receipt action', () => {
    const inner: MessageReadEvent = {
      type: 'message_read', channel_id: 'ch-1', message_id: 'm-1', user_id: 'u-2', read_at: 1700,
    }
    expect(routeChannelUpdate(inner)).toEqual({ kind: 'read_receipt', event: inner })
  })

  it('routes an opaque channel-metadata payload to a refetch action', () => {
    expect(routeChannelUpdate({ name: 'renamed', topic: 'x' })).toEqual({ kind: 'refetch_channels' })
  })

  it('does not misclassify the channel_update envelope itself as a read receipt', () => {
    // Locks the silent-failure mode of guarding `payload` instead of `payload.payload`:
    // the envelope (type 'channel_update') must route to a refetch, never a merge.
    expect(routeChannelUpdate({ type: 'channel_update', channel_id: 'ch-1', payload: {} }))
      .toEqual({ kind: 'refetch_channels' })
  })

  it('routes null / malformed inner payloads to a refetch action', () => {
    expect(routeChannelUpdate(null)).toEqual({ kind: 'refetch_channels' })
    expect(routeChannelUpdate({ type: 'message_read', message_id: 'm-1' })).toEqual({ kind: 'refetch_channels' })
  })
})
