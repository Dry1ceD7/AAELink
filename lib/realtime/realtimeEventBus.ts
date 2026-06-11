/**
 * `lib/realtimeEventBus.ts` — pure browser-side event bus that forwards
 * `typing` and `presence` events from the WS gateway into React components.
 *
 * The home shell creates one bus per session. The bus has two roles:
 *
 * 1. The shell's WS-event switch calls `bus.publishTyping(...)` / `bus.publishPresence(...)`
 *    inside the `case 'typing':` / `case 'presence':` branches.
 * 2. Components opt in via `bus.subscribeTyping(channelId, fn)` /
 *    `bus.subscribePresence(fn)`. When a component supplies these, it skips
 *    its own polling / SSE fallback entirely.
 *
 * Pure (no globals); the React tree gets the bus through a normal context
 * provider in the home shell.
 */

import type { TypingState, PresenceLastSeenMap } from '@/components/chat/realtimeEventApply'

export interface TypingChange {
  channelId: string
  userId: string
  active: boolean
}

export interface PresenceChange {
  userId: string
  lastSeen: number
  status: 'online' | 'away' | 'dnd' | 'offline'
}

export interface RealtimeEventBus {
  publishTyping(change: TypingChange): void
  subscribeTyping(channelId: string, fn: (change: TypingChange) => void): () => void
  publishPresence(change: PresenceChange): void
  subscribePresence(fn: (change: PresenceChange) => void): () => void
}

export function createRealtimeEventBus(): RealtimeEventBus {
  /** channel_id → set of subscriber callbacks */
  const typingSubs = new Map<string, Set<(c: TypingChange) => void>>()
  const presenceSubs = new Set<(c: PresenceChange) => void>()

  return {
    publishTyping(change) {
      const set = typingSubs.get(change.channelId)
      if (!set) return
      for (const fn of set) fn(change)
    },
    subscribeTyping(channelId, fn) {
      let set = typingSubs.get(channelId)
      if (!set) {
        set = new Set()
        typingSubs.set(channelId, set)
      }
      set.add(fn)
      return () => {
        set!.delete(fn)
        if (set!.size === 0) typingSubs.delete(channelId)
      }
    },
    publishPresence(change) {
      for (const fn of presenceSubs) fn(change)
    },
    subscribePresence(fn) {
      presenceSubs.add(fn)
      return () => {
        presenceSubs.delete(fn)
      }
    },
  }
}

// Re-export the pure state shapes so callers do not need a second import.
export type { TypingState, PresenceLastSeenMap }
