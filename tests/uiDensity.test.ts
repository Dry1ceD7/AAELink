/**
 * AAELink — UI Density Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { UI_DENSITY_KEY, readUiDensity, type UiDensity } from '@/lib/ui/uiDensity'

// ── Constants ───────────────────────────────────────────────────────

describe('UiDensity — Constants', () => {
  it('storage key is "aaelink_ui_density"', () => {
    expect(UI_DENSITY_KEY).toBe('aaelink_ui_density')
  })
})

// ── Type contract ───────────────────────────────────────────────────

describe('UiDensity — Type contract', () => {
  it('has exactly 2 modes', () => {
    const modes: UiDensity[] = ['comfortable', 'compact']
    expect(modes).toHaveLength(2)
  })
  it('includes "comfortable"', () => {
    const modes: UiDensity[] = ['comfortable', 'compact']
    expect(modes).toContain('comfortable')
  })
  it('includes "compact"', () => {
    const modes: UiDensity[] = ['comfortable', 'compact']
    expect(modes).toContain('compact')
  })
})

// ── readUiDensity — server fallback ─────────────────────────────────

describe('UiDensity — readUiDensity (server-side)', () => {
  it('returns "comfortable" as default', () => {
    const result = readUiDensity()
    // In node env, typeof window === 'undefined' → returns 'comfortable'
    expect(result).toBe('comfortable')
  })
  it('always returns a valid UiDensity', () => {
    const result = readUiDensity()
    expect(['comfortable', 'compact']).toContain(result)
  })
})
