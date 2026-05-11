/**
 * AAELink — Outbox Queue Type Tests
 */
import { describe, it, expect } from 'vitest'
import type { QueuedMessage } from '@/lib/outboxQueue'

describe('OutboxQueue — QueuedMessage shape', () => {
  it('accepts valid queued message', () => {
    const msg: QueuedMessage = {
      id: 'client-uuid-1',
      channel_id: 'ch-1',
      message: 'Hello offline world',
      queued_at: Date.now(),
    }
    expect(msg.id).toBe('client-uuid-1')
    expect(msg.channel_id).toBe('ch-1')
    expect(msg.message).toBe('Hello offline world')
    expect(msg.queued_at).toBeGreaterThan(0)
  })

  it('requires all fields', () => {
    const msg: QueuedMessage = {
      id: '',
      channel_id: '',
      message: '',
      queued_at: 0,
    }
    expect(msg.queued_at).toBe(0)
  })
})
