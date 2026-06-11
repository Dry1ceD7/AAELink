/**
 * AAELink — Default Channel Constants Tests
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHANNEL_NAME,
  DEFAULT_CHANNEL_DISPLAY_NAME,
  DEFAULT_CHANNEL_PURPOSE,
} from '@/lib/channels/defaultChannel'

describe('DefaultChannel — Constants', () => {
  it('name is general', () => {
    expect(DEFAULT_CHANNEL_NAME).toBe('general')
  })

  it('display name is General', () => {
    expect(DEFAULT_CHANNEL_DISPLAY_NAME).toBe('General')
  })

  it('purpose is non-empty', () => {
    expect(DEFAULT_CHANNEL_PURPOSE.length).toBeGreaterThan(10)
  })

  it('purpose mentions everyone', () => {
    expect(DEFAULT_CHANNEL_PURPOSE.toLowerCase()).toContain('everyone')
  })
})
