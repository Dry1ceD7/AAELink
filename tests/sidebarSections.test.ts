import { describe, expect, it } from 'vitest'
import { groupChannelsBySection, sectionKey, sectionLabel, RESERVED_CATEGORIES } from '@/lib/channels/sidebarSections'

describe('sectionKey', () => {
  it('lowercases and slugifies', () => {
    expect(sectionKey('My Important Projects')).toBe('my-important-projects')
  })
  it('strips disallowed punctuation', () => {
    expect(sectionKey('Q3 / Plan!!')).toBe('q3-plan')
  })
  it('caps length to 50 chars', () => {
    expect(sectionKey('A'.repeat(80)).length).toBeLessThanOrEqual(50)
  })
  it('returns empty string for empty input', () => {
    expect(sectionKey('   ')).toBe('')
  })
})

describe('sectionLabel', () => {
  it('reverses slug into Title Case', () => {
    expect(sectionLabel('my-important-projects')).toBe('My Important Projects')
  })
  it('handles single-word', () => {
    expect(sectionLabel('projects')).toBe('Projects')
  })
})

describe('RESERVED_CATEGORIES', () => {
  it('protects the built-in section names', () => {
    expect(RESERVED_CATEGORIES.has('_starred')).toBe(true)
    expect(RESERVED_CATEGORIES.has('favorites')).toBe(true)
    expect(RESERVED_CATEGORIES.has('channels')).toBe(true)
    expect(RESERVED_CATEGORIES.has('direct_messages')).toBe(true)
  })
})

describe('groupChannelsBySection', () => {
  type Ch = { id: string; name: string }
  const channels: Ch[] = [
    { id: 'c1', name: 'general' },
    { id: 'c2', name: 'random' },
    { id: 'c3', name: 'eng' },
    { id: 'c4', name: 'design' },
  ]

  it('puts un-categorized channels in ungrouped', () => {
    const { sections, ungrouped } = groupChannelsBySection(channels, new Map())
    expect(sections.size).toBe(0)
    expect(ungrouped.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('groups by category and skips reserved keys', () => {
    const assignments = new Map<string, string>([
      ['c1', 'projects'],
      ['c2', 'projects'],
      ['c3', 'q3'],
      ['c4', 'channels'], // reserved — should be ungrouped
    ])
    const { sections, ungrouped } = groupChannelsBySection(channels, assignments)
    expect(sections.get('projects')?.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(sections.get('q3')?.map(c => c.id)).toEqual(['c3'])
    expect(ungrouped.map(c => c.id)).toEqual(['c4'])
  })

  it('preserves channel order within a section', () => {
    const assignments = new Map<string, string>([
      ['c3', 'projects'],
      ['c1', 'projects'],
    ])
    const { sections } = groupChannelsBySection(channels, assignments)
    // Order should match the input order in `channels`, not the map insertion order.
    expect(sections.get('projects')?.map(c => c.id)).toEqual(['c1', 'c3'])
  })
})
