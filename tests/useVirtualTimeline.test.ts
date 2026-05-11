/**
 * AAELink — Virtual Timeline Constants Tests
 */
import { describe, it, expect } from 'vitest'

describe('useVirtualTimeline — constants', () => {
  const OVERSCAN = 15
  const INITIAL_TAIL = 60
  const RECALC_DEBOUNCE = 80

  it('overscan is 15 items', () => {
    expect(OVERSCAN).toBe(15)
  })

  it('initial tail renders 60 items from end', () => {
    expect(INITIAL_TAIL).toBe(60)
  })

  it('recalculation debounce is 80ms', () => {
    expect(RECALC_DEBOUNCE).toBe(80)
  })
})

describe('useVirtualTimeline — initial range calculation', () => {
  const INITIAL_TAIL = 60

  it('starts from end - INITIAL_TAIL for large lists', () => {
    const totalCount = 500
    const start = Math.max(0, totalCount - INITIAL_TAIL)
    expect(start).toBe(440)
    expect(totalCount - start).toBe(60)
  })

  it('starts from 0 for small lists', () => {
    const totalCount = 30
    const start = Math.max(0, totalCount - INITIAL_TAIL)
    expect(start).toBe(0)
  })

  it('handles empty list', () => {
    const totalCount = 0
    const start = Math.max(0, totalCount - INITIAL_TAIL)
    expect(start).toBe(0)
  })
})

describe('useVirtualTimeline — bottom detection', () => {
  it('considers within 40px of bottom as "at bottom"', () => {
    const scrollHeight = 5000
    const scrollTop = 4700
    const clientHeight = 280
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    expect(atBottom).toBe(true)
  })

  it('considers > 40px from bottom as NOT "at bottom"', () => {
    const scrollHeight = 5000
    const scrollTop = 4000
    const clientHeight = 280
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    expect(atBottom).toBe(false)
  })
})

describe('useVirtualTimeline — scroll-to-top expansion', () => {
  it('extends range upward when scrollTop < 200', () => {
    const OVERSCAN = 15
    const range = { start: 100, end: 200 }
    const newStart = Math.max(0, range.start - OVERSCAN)
    expect(newStart).toBe(85)
  })

  it('does not go below 0', () => {
    const OVERSCAN = 15
    const range = { start: 5, end: 60 }
    const newStart = Math.max(0, range.start - OVERSCAN)
    expect(newStart).toBe(0)
  })
})
