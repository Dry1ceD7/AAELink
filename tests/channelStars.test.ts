/**
 * AAELink — Channel Stars Tests (localStorage mock)
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

vi.mock('@/lib/api/apiClient', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}))

Object.defineProperty(globalThis, 'window', {
  value: { localStorage: mockLocalStorage },
  writable: true,
})
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true })

import { readStarredChannels, isChannelStarred } from '@/lib/channels/channelStars'

describe('ChannelStars — readStarredChannels', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns empty set when no data', () => {
    const s = readStarredChannels()
    expect(s.size).toBe(0)
  })

  it('reads from localStorage', () => {
    store['aaelink-starred-channels'] = JSON.stringify(['ch-a', 'ch-b'])
    const s = readStarredChannels()
    expect(s.has('ch-a')).toBe(true)
    expect(s.has('ch-b')).toBe(true)
  })

  it('handles corrupted data gracefully', () => {
    store['aaelink-starred-channels'] = '{broken'
    expect(readStarredChannels().size).toBe(0)
  })
})

describe('ChannelStars — isChannelStarred', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns false for unstarred channel', () => {
    expect(isChannelStarred('ch-x')).toBe(false)
  })

  it('returns true for starred channel', () => {
    store['aaelink-starred-channels'] = JSON.stringify(['ch-x'])
    expect(isChannelStarred('ch-x')).toBe(true)
  })
})
