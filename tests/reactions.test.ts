/**
 * AAELink — Reactions Tests
 */
import { describe, it, expect } from 'vitest'
import {
  REACTION_KEYS, isAllowedReactionKey, isValidReactionKey,
  reactionToEmoji, REACTION_EMOJI_MAP,
} from '@/lib/messaging/reactions'

describe('Reactions — isAllowedReactionKey', () => {
  it('accepts all built-in keys', () => {
    for (const k of REACTION_KEYS) {
      expect(isAllowedReactionKey(k)).toBe(true)
    }
  })
  it('rejects unknown key', () => {
    expect(isAllowedReactionKey('clap')).toBe(false)
  })
  it('rejects empty', () => {
    expect(isAllowedReactionKey('')).toBe(false)
  })
})

describe('Reactions — isValidReactionKey', () => {
  it('accepts built-in keys', () => {
    expect(isValidReactionKey('thumbs_up')).toBe(true)
    expect(isValidReactionKey('heart')).toBe(true)
  })
  it('accepts native emoji', () => {
    expect(isValidReactionKey('🎉')).toBe(true)
    expect(isValidReactionKey('👍')).toBe(true)
  })
  it('rejects empty', () => {
    expect(isValidReactionKey('')).toBe(false)
  })
  it('rejects long strings', () => {
    expect(isValidReactionKey('a'.repeat(21))).toBe(false)
  })
  it('rejects plain text', () => {
    expect(isValidReactionKey('hello')).toBe(false)
  })
})

describe('Reactions — reactionToEmoji', () => {
  it('maps thumbs_up → 👍', () => {
    expect(reactionToEmoji('thumbs_up')).toBe('👍')
  })
  it('maps heart → ❤️', () => {
    expect(reactionToEmoji('heart')).toBe('❤️')
  })
  it('passes through native emoji', () => {
    expect(reactionToEmoji('🎉')).toBe('🎉')
  })
  it('all keys have emoji mappings', () => {
    for (const k of REACTION_KEYS) {
      expect(REACTION_EMOJI_MAP[k]).toBeTruthy()
    }
  })
})
