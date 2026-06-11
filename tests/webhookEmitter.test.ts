/**
 * AAELink — Webhook Event Types Tests
 */
import { describe, it, expect } from 'vitest'
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/lib/webhooks/webhookEmitter'

describe('WebhookEmitter — WEBHOOK_EVENT_TYPES', () => {
  it('includes message events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('message.created')
    expect(types).toContain('message.updated')
    expect(types).toContain('message.deleted')
  })

  it('includes channel events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('channel.created')
    expect(types).toContain('channel.archived')
    expect(types).toContain('channel.member_joined')
    expect(types).toContain('channel.member_left')
  })

  it('includes user events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('user.created')
    expect(types).toContain('user.updated')
    expect(types).toContain('user.deactivated')
  })

  it('includes reaction events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('reaction.added')
    expect(types).toContain('reaction.removed')
  })

  it('includes file events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('file.uploaded')
    expect(types).toContain('file.deleted')
  })

  it('includes compliance events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('compliance.dlp_violation')
    expect(types).toContain('compliance.legal_hold_created')
  })

  it('includes call events', () => {
    const types = WEBHOOK_EVENT_TYPES as readonly string[]
    expect(types).toContain('call.started')
    expect(types).toContain('call.ended')
  })

  it('all types follow dot notation', () => {
    for (const t of WEBHOOK_EVENT_TYPES) {
      expect(t).toMatch(/^[a-z]+\.[a-z_]+$/)
    }
  })

  it('type safety — WebhookEventType matches array', () => {
    const t: WebhookEventType = 'message.created'
    expect(WEBHOOK_EVENT_TYPES).toContain(t)
  })
})
