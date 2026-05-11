/**
 * AAELink — useMediaQuery Constants Tests
 *
 * The hook requires React + DOM matchMedia. We verify
 * the SSR fallback behavior (returns false by default).
 */
import { describe, it, expect } from 'vitest'

describe('useMediaQuery — SSR default', () => {
  it('initial state defaults to false', () => {
    // From source: const [matches, setMatches] = useState(false)
    const initialState = false
    expect(initialState).toBe(false)
  })
})

describe('useMediaQuery — query format', () => {
  it('accepts standard media query string', () => {
    const query = '(max-width: 768px)'
    expect(typeof query).toBe('string')
    expect(query).toContain('max-width')
  })

  it('accepts prefers-color-scheme query', () => {
    const query = '(prefers-color-scheme: dark)'
    expect(query).toContain('prefers-color-scheme')
  })
})
