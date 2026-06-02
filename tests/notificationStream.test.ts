/**
 * AAELink — Notification Stream Type Tests
 */
import { describe, it, expect } from 'vitest'
import type { NotificationStreamPayload } from '@/lib/notifications/notificationStream'

describe('NotificationStream — NotificationStreamPayload', () => {
  it('accepts payload with unread_count', () => {
    const p: NotificationStreamPayload = { unread_count: 3 }
    expect(p.unread_count).toBe(3)
    expect(p.latest).toBeUndefined()
  })

  it('accepts payload with latest notification', () => {
    const p: NotificationStreamPayload = {
      unread_count: 1,
      latest: {
        id: 'n-1',
        kind: 'mention',
        title: 'New mention',
        body: 'Hello',
        workspace_id: 'ws-1',
        channel_id: 'ch-1',
        message_id: 'msg-1',
        ticket_id: null,
        read_at: 0,
        created_at: Date.now(),
      },
    }
    expect(p.latest?.kind).toBe('mention')
  })

  it('accepts null latest', () => {
    const p: NotificationStreamPayload = { unread_count: 0, latest: null }
    expect(p.latest).toBeNull()
  })
})
