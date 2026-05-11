/**
 * AAELink — Constants Tests
 */
import { describe, it, expect } from 'vitest'
import { AAELINK_GLOBAL_WORKSPACE_ID } from '@/lib/constants'

describe('Constants', () => {
  it('global workspace ID is defined', () => {
    expect(AAELINK_GLOBAL_WORKSPACE_ID).toBe('aaelink-ws-global')
  })
  it('global workspace ID is a non-empty string', () => {
    expect(typeof AAELINK_GLOBAL_WORKSPACE_ID).toBe('string')
    expect(AAELINK_GLOBAL_WORKSPACE_ID.length).toBeGreaterThan(0)
  })
})
