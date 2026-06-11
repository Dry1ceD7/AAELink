/**
 * AAELink — Notification Href Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { hrefForNotification } from '@/lib/notifications/notificationHref'
import type { ApiNotification } from '@/lib/notifications/notificationTypes'

function makeNotification(overrides: Partial<ApiNotification> = {}): ApiNotification {
  return {
    id: 'n1',
    kind: 'message',
    title: 'Test',
    body: 'Hello',
    workspace_id: 'ws-1',
    channel_id: null,
    message_id: null,
    ticket_id: null,
    read_at: 0,
    created_at: Date.now(),
    ...overrides,
  }
}

// ── Kind-based routing ──────────────────────────────────────────────

describe('NotificationHref — kind-based routing', () => {
  it('support_emergency → /admin', () => {
    expect(hrefForNotification(makeNotification({ kind: 'support_emergency' }))).toBe('/admin')
  })

  it('non-emergency kinds use /home', () => {
    const h = hrefForNotification(makeNotification({ kind: 'message' }))
    expect(h).toMatch(/^\/home/)
  })

  it('custom kind still routes to /home', () => {
    const h = hrefForNotification(makeNotification({ kind: 'mention' }))
    expect(h).toMatch(/^\/home/)
  })
})

// ── Priority resolution ─────────────────────────────────────────────

describe('NotificationHref — priority resolution', () => {
  it('message_id takes highest priority', () => {
    const h = hrefForNotification(makeNotification({
      message_id: 'msg-1',
      channel_id: 'ch-1',
      ticket_id: 'tk-1',
    }))
    expect(h).toContain('focus_msg=msg-1')
    expect(h).not.toContain('channel=')
    expect(h).not.toContain('ticket=')
  })

  it('channel_id takes priority over ticket_id', () => {
    const h = hrefForNotification(makeNotification({
      channel_id: 'ch-1',
      ticket_id: 'tk-1',
    }))
    expect(h).toContain('channel=ch-1')
    expect(h).not.toContain('ticket=')
  })

  it('ticket_id used when no message or channel', () => {
    const h = hrefForNotification(makeNotification({
      ticket_id: 'tk-1',
    }))
    expect(h).toContain('module=tickets')
    expect(h).toContain('ticket=tk-1')
  })

  it('bare workspace when no specific IDs', () => {
    const h = hrefForNotification(makeNotification())
    expect(h).toBe('/home?team=ws-1')
  })
})

// ── URL encoding ────────────────────────────────────────────────────

describe('NotificationHref — URL encoding', () => {
  it('encodes workspace_id special chars', () => {
    const h = hrefForNotification(makeNotification({ workspace_id: 'w s/1' }))
    expect(h).toContain('team=w%20s%2F1')
  })

  it('encodes channel_id special chars', () => {
    const h = hrefForNotification(makeNotification({ channel_id: 'c&h' }))
    expect(h).toContain('channel=c%26h')
  })

  it('encodes message_id special chars', () => {
    const h = hrefForNotification(makeNotification({ message_id: 'm=1' }))
    expect(h).toContain('focus_msg=m%3D1')
  })

  it('encodes ticket_id special chars', () => {
    const h = hrefForNotification(makeNotification({ ticket_id: 't?k' }))
    expect(h).toContain('ticket=t%3Fk')
  })
})

// ── Path structure ──────────────────────────────────────────────────

describe('NotificationHref — path structure', () => {
  it('message notification has focus_msg param', () => {
    const h = hrefForNotification(makeNotification({ message_id: 'msg-42' }))
    expect(h).toBe('/home?team=ws-1&focus_msg=msg-42')
  })

  it('channel notification has channel param', () => {
    const h = hrefForNotification(makeNotification({ channel_id: 'ch-7' }))
    expect(h).toBe('/home?team=ws-1&channel=ch-7')
  })

  it('ticket notification has module and ticket params', () => {
    const h = hrefForNotification(makeNotification({ ticket_id: 'tk-99' }))
    expect(h).toBe('/home?team=ws-1&module=tickets&ticket=tk-99')
  })

  it('always includes team param for non-emergency', () => {
    const h = hrefForNotification(makeNotification())
    expect(h).toContain('team=ws-1')
  })
})
