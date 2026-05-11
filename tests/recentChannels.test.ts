/**
 * AAELink — Recent Channels Tests (localStorage mock)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v }),
  removeItem: vi.fn((k: string) => { delete store[k] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  key: vi.fn((_i: number) => null),
  length: 0,
} satisfies Storage

Object.defineProperty(globalThis, 'window', {
  value: { localStorage: mockLocalStorage },
  writable: true,
})
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true })

const KEY = 'aaelink_recent_channel_ids_v1'

import { readRecentChannelIds, touchRecentChannel } from '@/lib/recentChannels'

describe('RecentChannels — readRecentChannelIds', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns empty array when no data', () => {
    expect(readRecentChannelIds()).toEqual([])
  })

  it('reads stored channel IDs', () => {
    store[KEY] = JSON.stringify(['ch-1', 'ch-2', 'ch-3'])
    expect(readRecentChannelIds()).toEqual(['ch-1', 'ch-2', 'ch-3'])
  })

  it('filters non-string entries', () => {
    store[KEY] = JSON.stringify(['ch-1', 42, null, 'ch-2'])
    const ids = readRecentChannelIds()
    expect(ids).toEqual(['ch-1', 'ch-2'])
  })
})

describe('RecentChannels — touchRecentChannel', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('records a channel visit', () => {
    touchRecentChannel('ch-new')
    const ids = readRecentChannelIds()
    expect(ids).toContain('ch-new')
  })

  it('moves revisited channel to front', () => {
    store[KEY] = JSON.stringify(['ch-1', 'ch-2', 'ch-3'])
    touchRecentChannel('ch-3')
    const ids = readRecentChannelIds()
    expect(ids[0]).toBe('ch-3')
  })

  it('caps at max length (40)', () => {
    const many = Array.from({ length: 50 }, (_, i) => `ch-${i}`)
    store[KEY] = JSON.stringify(many)
    touchRecentChannel('ch-new')
    const ids = readRecentChannelIds()
    expect(ids.length).toBeLessThanOrEqual(40)
    expect(ids[0]).toBe('ch-new')
  })
})
