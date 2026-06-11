/**
 * AAELink — Mention Cursor Tests
 */
import { describe, it, expect } from 'vitest'
import { mentionPrefixAtCursor, applyMentionPick } from '@/lib/messaging/mentionCursor'

describe('MentionCursor — mentionPrefixAtCursor', () => {
  it('detects @query at cursor', () => {
    const r = mentionPrefixAtCursor('hello @ali', 10)
    expect(r).toEqual({ atIndex: 6, query: 'ali' })
  })

  it('detects bare @ with empty query', () => {
    const r = mentionPrefixAtCursor('hello @', 7)
    expect(r).toEqual({ atIndex: 6, query: '' })
  })

  it('returns null when no @ before cursor', () => {
    expect(mentionPrefixAtCursor('hello world', 11)).toBeNull()
  })

  it('returns null when @ is followed by space before cursor', () => {
    expect(mentionPrefixAtCursor('@ bob', 5)).toBeNull()
  })

  it('supports unicode usernames', () => {
    const r = mentionPrefixAtCursor('cc @สมช', 8)
    expect(r?.query).toBe('สมช')
  })

  it('respects cursor position mid-word', () => {
    const r = mentionPrefixAtCursor('@alice test', 3)
    expect(r).toEqual({ atIndex: 0, query: 'al' })
  })

  it('handles cursor at start', () => {
    expect(mentionPrefixAtCursor('hello', 0)).toBeNull()
  })
})

describe('MentionCursor — applyMentionPick', () => {
  it('replaces @prefix with full username + space', () => {
    const r = applyMentionPick('hello @al', 6, 9, 'alice')
    expect(r.text).toBe('hello @alice ')
    expect(r.selectionStart).toBe(13)
  })

  it('strips leading @ from username', () => {
    const r = applyMentionPick('@b', 0, 2, '@bob')
    expect(r.text).toBe('@bob ')
    expect(r.selectionStart).toBe(5)
  })

  it('preserves text after cursor', () => {
    const r = applyMentionPick('hi @al world', 3, 6, 'alice')
    expect(r.text).toBe('hi @alice  world')
  })

  it('handles empty prefix', () => {
    const r = applyMentionPick('test @', 5, 6, 'carol')
    expect(r.text).toBe('test @carol ')
  })
})
