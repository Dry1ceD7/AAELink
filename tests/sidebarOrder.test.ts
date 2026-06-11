/**
 * Sidebar slot ordering — drag-to-reorder default sections (Slack §1.4).
 *
 * The slot ids are:
 *   - 'starred'    — Starred section (only shown when at least one channel is starred)
 *   - '__custom__' — placeholder that expands to all custom user-defined sections
 *   - 'channels'   — public/private channels the user belongs to
 *   - 'dms'        — direct messages and group DMs
 *
 * Enterprise and Administration are NOT in this list — they are navigation
 * surfaces, not conversation sections, and stay pinned at the bottom of the
 * sidebar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIDEBAR_ORDER,
  KNOWN_SLOTS,
  isValidSidebarOrder,
  moveSlot,
  normaliseSidebarOrder,
  readSidebarOrder,
  persistSidebarOrder,
  type SidebarSlotId,
} from '@/lib/channels/sidebarOrder'

describe('DEFAULT_SIDEBAR_ORDER', () => {
  it('matches the hardcoded render order before v0.0.28', () => {
    expect(DEFAULT_SIDEBAR_ORDER).toEqual(['starred', '__custom__', 'channels', 'dms'])
  })

  it('contains every known slot exactly once', () => {
    expect([...DEFAULT_SIDEBAR_ORDER].sort()).toEqual([...KNOWN_SLOTS].sort())
  })
})

describe('isValidSidebarOrder', () => {
  it('accepts the default order', () => {
    expect(isValidSidebarOrder(DEFAULT_SIDEBAR_ORDER)).toBe(true)
  })

  it('accepts any permutation of the known slots', () => {
    expect(isValidSidebarOrder(['dms', 'channels', '__custom__', 'starred'])).toBe(true)
  })

  it('rejects orders with unknown slot ids', () => {
    expect(isValidSidebarOrder(['starred', 'admin'] as unknown[])).toBe(false)
  })

  it('rejects orders with duplicated slots', () => {
    expect(isValidSidebarOrder(['starred', 'starred', 'channels', 'dms'] as unknown[])).toBe(false)
  })

  it('rejects orders missing slots', () => {
    expect(isValidSidebarOrder(['starred', 'channels'] as unknown[])).toBe(false)
  })

  it('rejects non-array input', () => {
    expect(isValidSidebarOrder('starred,channels,dms')).toBe(false)
    expect(isValidSidebarOrder(null)).toBe(false)
    expect(isValidSidebarOrder(undefined)).toBe(false)
  })
})

describe('normaliseSidebarOrder', () => {
  it('returns the default order when input is invalid', () => {
    expect(normaliseSidebarOrder('garbage')).toEqual(DEFAULT_SIDEBAR_ORDER)
    expect(normaliseSidebarOrder(null)).toEqual(DEFAULT_SIDEBAR_ORDER)
    expect(normaliseSidebarOrder(undefined)).toEqual(DEFAULT_SIDEBAR_ORDER)
    expect(normaliseSidebarOrder(['starred'])).toEqual(DEFAULT_SIDEBAR_ORDER)
  })

  it('preserves a valid input order', () => {
    const order = ['dms', 'channels', '__custom__', 'starred'] as const
    expect(normaliseSidebarOrder([...order])).toEqual([...order])
  })

  it('appends missing slots after the user-saved ones', () => {
    // Older saved state from when there were only three slots — the user's
    // chosen order for the slots they know about is preserved; the new
    // `__custom__` slot lands at the end so existing pinning doesn't shift.
    expect(normaliseSidebarOrder(['starred', 'channels', 'dms'])).toEqual([
      'starred', 'channels', 'dms', '__custom__',
    ])
  })

  it('drops unknown slots and re-fills missing ones (also appended)', () => {
    expect(normaliseSidebarOrder(['starred', 'channels', 'unknown', 'dms'])).toEqual([
      'starred', 'channels', 'dms', '__custom__',
    ])
  })
})

describe('moveSlot', () => {
  it('moves a slot from one index to another', () => {
    const order: SidebarSlotId[] = ['starred', '__custom__', 'channels', 'dms']
    const next = moveSlot(order, 0, 3)
    expect(next).toEqual(['__custom__', 'channels', 'dms', 'starred'])
  })

  it('handles a no-op move (same index)', () => {
    const order: SidebarSlotId[] = ['starred', '__custom__', 'channels', 'dms']
    expect(moveSlot(order, 1, 1)).toEqual(order)
  })

  it('clamps out-of-range indices to the array bounds', () => {
    const order: SidebarSlotId[] = ['starred', '__custom__', 'channels', 'dms']
    expect(moveSlot(order, -1, 1)).toEqual(order) // negative source → no-op
    expect(moveSlot(order, 0, 99)).toEqual(['__custom__', 'channels', 'dms', 'starred'])
  })

  it('does not mutate the input array', () => {
    const order: SidebarSlotId[] = ['starred', '__custom__', 'channels', 'dms']
    const copy = [...order]
    moveSlot(order, 0, 3)
    expect(order).toEqual(copy)
  })
})

describe('readSidebarOrder / persistSidebarOrder', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    const fakeStorage: Storage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v },
      removeItem: (k) => { delete store[k] },
      clear: () => { store = {} },
      key: (i) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length },
    }
    vi.stubGlobal('window', { localStorage: fakeStorage })
    vi.stubGlobal('localStorage', fakeStorage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the default when nothing is stored', () => {
    expect(readSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER)
  })

  it('returns the default when the stored value is malformed JSON', () => {
    store['aaelink-sidebar-order'] = 'not json'
    expect(readSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER)
  })

  it('returns the default when the stored value is invalid', () => {
    store['aaelink-sidebar-order'] = JSON.stringify(['starred', 'unknown'])
    expect(readSidebarOrder()).toEqual(DEFAULT_SIDEBAR_ORDER)
  })

  it('persistSidebarOrder is a no-op for invalid input', () => {
    persistSidebarOrder(['starred', 'unknown'] as unknown as typeof DEFAULT_SIDEBAR_ORDER)
    expect('aaelink-sidebar-order' in store).toBe(false)
  })
})
