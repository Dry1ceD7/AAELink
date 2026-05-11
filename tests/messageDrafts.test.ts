/**
 * AAELink — Message Drafts Tests (localStorage mock)
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

const DRAFTS_KEY = 'aaelink-drafts'

import {
  getDraft,
  saveDraft,
  clearDraft,
  getChannelIdsWithDrafts,
  getDraftCount,
} from '@/lib/messageDrafts'

describe('MessageDrafts — saveDraft / getDraft / clearDraft', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns empty string for missing draft', () => {
    expect(getDraft('ch-1')).toBe('')
  })

  it('saves and reads a draft', () => {
    saveDraft('ch-1', 'hello world')
    expect(getDraft('ch-1')).toBe('hello world')
  })

  it('overwrites existing draft', () => {
    saveDraft('ch-1', 'first')
    saveDraft('ch-1', 'second')
    expect(getDraft('ch-1')).toBe('second')
  })

  it('clears a draft', () => {
    saveDraft('ch-1', 'data')
    clearDraft('ch-1')
    expect(getDraft('ch-1')).toBe('')
  })

  it('isolates drafts per channel', () => {
    saveDraft('ch-1', 'one')
    saveDraft('ch-2', 'two')
    expect(getDraft('ch-1')).toBe('one')
    expect(getDraft('ch-2')).toBe('two')
  })

  it('survives corrupted localStorage', () => {
    store[DRAFTS_KEY] = 'not-valid-json'
    expect(getDraft('ch-1')).toBe('')
  })

  it('saving empty text removes the draft', () => {
    saveDraft('ch-1', 'data')
    saveDraft('ch-1', '   ')
    expect(getDraft('ch-1')).toBe('')
  })
})

describe('MessageDrafts — getChannelIdsWithDrafts / getDraftCount', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('returns empty when no drafts', () => {
    expect(getChannelIdsWithDrafts()).toEqual([])
    expect(getDraftCount()).toBe(0)
  })

  it('lists channels with active drafts', () => {
    saveDraft('ch-1', 'foo')
    saveDraft('ch-2', 'bar')
    const ids = getChannelIdsWithDrafts()
    expect(ids).toContain('ch-1')
    expect(ids).toContain('ch-2')
    expect(getDraftCount()).toBe(2)
  })
})
