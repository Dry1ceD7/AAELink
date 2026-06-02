/**
 * `lib/realtimeEventBus.ts` — pure publish/subscribe bus for typing and
 * presence events. The WS-enabled home shell publishes events; consumers
 * (`<TypingIndicator>`, `usePresenceListener`) subscribe.
 */

import { describe, it, expect } from 'vitest'
import { createRealtimeEventBus } from '@/lib/realtime/realtimeEventBus'

describe('realtimeEventBus — typing', () => {
  it('delivers a typing change to subscribers of the matching channel', () => {
    const bus = createRealtimeEventBus()
    const seen: Array<string> = []
    bus.subscribeTyping('ch-1', (c) => seen.push(`${c.userId}:${c.active}`))
    bus.publishTyping({ channelId: 'ch-1', userId: 'u-2', active: true })
    expect(seen).toEqual(['u-2:true'])
  })

  it('does not deliver typing changes to other channels', () => {
    const bus = createRealtimeEventBus()
    const seen: Array<string> = []
    bus.subscribeTyping('ch-2', (c) => seen.push(c.userId))
    bus.publishTyping({ channelId: 'ch-1', userId: 'u-2', active: true })
    expect(seen).toEqual([])
  })

  it('removes the subscriber on unsubscribe', () => {
    const bus = createRealtimeEventBus()
    let count = 0
    const off = bus.subscribeTyping('ch-1', () => { count += 1 })
    bus.publishTyping({ channelId: 'ch-1', userId: 'u-2', active: true })
    off()
    bus.publishTyping({ channelId: 'ch-1', userId: 'u-2', active: false })
    expect(count).toBe(1)
  })

  it('supports multiple concurrent subscribers per channel', () => {
    const bus = createRealtimeEventBus()
    let a = 0
    let b = 0
    bus.subscribeTyping('ch-1', () => { a += 1 })
    bus.subscribeTyping('ch-1', () => { b += 1 })
    bus.publishTyping({ channelId: 'ch-1', userId: 'u-2', active: true })
    expect(a).toBe(1)
    expect(b).toBe(1)
  })
})

describe('realtimeEventBus — presence', () => {
  it('delivers presence changes to all presence subscribers', () => {
    const bus = createRealtimeEventBus()
    const seen: Array<number> = []
    bus.subscribePresence((c) => seen.push(c.lastSeen))
    bus.publishPresence({ userId: 'u-1', lastSeen: 1700, status: 'online' })
    expect(seen).toEqual([1700])
  })

  it('removes the subscriber on unsubscribe', () => {
    const bus = createRealtimeEventBus()
    let count = 0
    const off = bus.subscribePresence(() => { count += 1 })
    bus.publishPresence({ userId: 'u-1', lastSeen: 1, status: 'online' })
    off()
    bus.publishPresence({ userId: 'u-1', lastSeen: 2, status: 'away' })
    expect(count).toBe(1)
  })
})
