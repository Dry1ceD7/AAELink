/**
 * AAELink — Channel Mute Tests (localStorage mock)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => { store[k] = v }),
  removeItem: vi.fn((k: string) => { delete store[k] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  key: vi.fn((_i: number) => null),
  length: 0,
} satisfies Storage

// Mock apiFetch to avoid real network calls
vi.mock('@/lib/apiClient', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}))

Object.defineProperty(globalThis, 'window', {
  value: { localStorage: mockLocalStorage },
  writable: true,
})
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true })

import { readMutedChannels, isChannelMuted } from '@/lib/channelMute'

describe('ChannelMute — readMutedChannels', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns empty set when no data', () => {
    const s = readMutedChannels()
    expect(s.size).toBe(0)
  })

  it('reads from localStorage', () => {
    store['aaelink-muted-channels'] = JSON.stringify(['ch-1', 'ch-2'])
    const s = readMutedChannels()
    expect(s.size).toBe(2)
    expect(s.has('ch-1')).toBe(true)
    expect(s.has('ch-2')).toBe(true)
  })

  it('returns empty set on invalid JSON', () => {
    store['aaelink-muted-channels'] = 'not-json'
    const s = readMutedChannels()
    expect(s.size).toBe(0)
  })
})

describe('ChannelMute — isChannelMuted', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns false when not muted', () => {
    expect(isChannelMuted('ch-99')).toBe(false)
  })

  it('returns true when muted', () => {
    store['aaelink-muted-channels'] = JSON.stringify(['ch-99'])
    expect(isChannelMuted('ch-99')).toBe(true)
  })
})
