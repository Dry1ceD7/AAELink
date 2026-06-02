/**
 * AAELink — Notification Types Tests
 */
import { describe, it, expect } from 'vitest'
import type { ApiNotification } from '@/lib/notifications/notificationTypes'

describe('NotificationTypes — ApiNotification shape', () => {
  it('accepts valid notification object', () => {
    const n: ApiNotification = {
      id: 'n-1',
      kind: 'mention',
      title: 'New mention',
      body: 'You were mentioned in #general',
      workspace_id: 'ws-1',
      channel_id: 'ch-1',
      message_id: 'msg-1',
      ticket_id: null,
      read_at: 0,
      created_at: Date.now(),
    }
    expect(n.id).toBe('n-1')
    expect(n.kind).toBe('mention')
    expect(n.ticket_id).toBeNull()
    expect(n.read_at).toBe(0)
  })

  it('allows null channel_id', () => {
    const n: ApiNotification = {
      id: 'n-2', kind: 'system', title: 'Update', body: 'System update',
      workspace_id: 'ws-1', channel_id: null, message_id: null, ticket_id: null,
      read_at: 0, created_at: Date.now(),
    }
    expect(n.channel_id).toBeNull()
    expect(n.message_id).toBeNull()
  })
})
