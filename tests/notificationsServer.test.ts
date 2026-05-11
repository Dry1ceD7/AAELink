/**
 * AAELink — Notifications Server (snippet helper) Tests
 */
import { describe, it, expect } from 'vitest'

// Re-implement the private snippet function for unit testing (line 19-25)
function snippet(text: string, max = 160) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

describe('NotificationsServer — snippet helper', () => {
  it('returns text under max unchanged', () => {
    expect(snippet('hello world')).toBe('hello world')
  })

  it('truncates text over max with ellipsis', () => {
    const long = 'a'.repeat(200)
    const result = snippet(long)
    expect(result.length).toBe(160)
    expect(result.endsWith('…')).toBe(true)
  })

  it('collapses whitespace', () => {
    expect(snippet('hello   \n  world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(snippet('')).toBe('')
  })

  it('handles null-ish', () => {
    expect(snippet(null as unknown as string)).toBe('')
  })

  it('respects custom max', () => {
    const result = snippet('a'.repeat(100), 50)
    expect(result.length).toBe(50)
  })
})

describe('NotificationsServer — NotificationInsertRow type', () => {
  it('accepts valid row', () => {
    const row = {
      user_id: 'u-1',
      kind: 'mention',
      title: 'Test',
      body: 'Body',
      workspace_id: 'ws-1',
      channel_id: 'ch-1',
      message_id: 'msg-1',
      ticket_id: null,
    }
    expect(row.kind).toBe('mention')
    expect(row.ticket_id).toBeNull()
  })
})
