/**
 * AAELink — Audit Stream Engine Tests
 *
 * Validates formatting, delivery logic, and streamer lifecycle
 * for all five SIEM destination types.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { formatters, AuditStreamer, type AuditEvent } from '@/lib/auditStream'

// ── Fixtures ─────────────────────────────────────────────────────────

function mockEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt-001',
    actor_id: 'user-abc',
    action: 'message.created',
    entity_type: 'message',
    entity_id: 'msg-xyz',
    ip_address: '10.0.0.1',
    user_agent: 'Mozilla/5.0',
    meta: { channel: 'general' },
    created_at: 1714500000000,
    workspace_id: 'ws-main',
    ...overrides,
  }
}

// ── Splunk Formatter ─────────────────────────────────────────────────

describe('Audit Stream — Splunk Formatter', () => {
  it('produces valid Splunk HEC JSON with event wrapper', () => {
    const output = formatters.splunk([mockEvent()])
    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty('event')
    expect(parsed.event.action).toBe('message.created')
    expect(parsed.event.actor_id).toBe('user-abc')
    expect(parsed.source).toBe('aaelink')
    expect(parsed.sourcetype).toBe('aaelink:audit')
    expect(parsed.time).toBeTypeOf('number')
  })

  it('batches multiple events as newline-delimited JSON', () => {
    const events = [mockEvent({ id: 'e1' }), mockEvent({ id: 'e2' })]
    const output = formatters.splunk(events)
    const lines = output.trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).event.action).toBe('message.created')
    expect(JSON.parse(lines[1]).event.action).toBe('message.created')
  })
})

// ── Elasticsearch Formatter ──────────────────────────────────────────

describe('Audit Stream — Elasticsearch Formatter', () => {
  it('produces valid NDJSON bulk format', () => {
    const output = formatters.elasticsearch([mockEvent()], 'audit-idx')
    const lines = output.trim().split('\n')
    expect(lines.length).toBe(2) // action + doc
    const action = JSON.parse(lines[0])
    expect(action.index._index).toBe('audit-idx')
    expect(action.index._id).toBe('evt-001')
    const doc = JSON.parse(lines[1])
    expect(doc['@timestamp']).toBeTruthy()
    expect(doc.action).toBe('message.created')
  })

  it('handles multiple events correctly', () => {
    const events = [mockEvent({ id: 'e1' }), mockEvent({ id: 'e2' })]
    const output = formatters.elasticsearch(events, 'idx')
    const lines = output.trim().split('\n')
    expect(lines.length).toBe(4) // 2 actions + 2 docs
  })
})

// ── S3 Formatter ─────────────────────────────────────────────────────

describe('Audit Stream — S3 Formatter', () => {
  it('produces JSON Lines format', () => {
    const output = formatters.s3([mockEvent()])
    const lines = output.trim().split('\n')
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.id).toBe('evt-001')
    expect(parsed.timestamp).toBeTruthy()
    expect(parsed.action).toBe('message.created')
  })
})

// ── Webhook Formatter ────────────────────────────────────────────────

describe('Audit Stream — Webhook Formatter', () => {
  it('wraps events in a webhook payload envelope', () => {
    const output = formatters.webhook([mockEvent()])
    const parsed = JSON.parse(output)
    expect(parsed.source).toBe('aaelink')
    expect(parsed.version).toBe('1.0')
    expect(parsed.event_count).toBe(1)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0].action).toBe('message.created')
  })

  it('includes correct event_count for batches', () => {
    const events = [mockEvent({ id: 'e1' }), mockEvent({ id: 'e2' }), mockEvent({ id: 'e3' })]
    const parsed = JSON.parse(formatters.webhook(events))
    expect(parsed.event_count).toBe(3)
    expect(parsed.events).toHaveLength(3)
  })
})

// ── Syslog Formatter ─────────────────────────────────────────────────

describe('Audit Stream — Syslog Formatter', () => {
  it('produces RFC 5424 structured data format', () => {
    const output = formatters.syslog([mockEvent()])
    expect(output).toContain('<14>')              // PRI
    expect(output).toContain('aaelink')           // APP-NAME
    expect(output).toContain('evt-001')           // MSGID
    expect(output).toContain('action="message.created"')
    expect(output).toContain('actor="user-abc"')
    expect(output).toContain('ip="10.0.0.1"')
  })
})

// ── Streamer Lifecycle ───────────────────────────────────────────────

describe('Audit Stream — Streamer', () => {
  it('tracks stream status after addStream', () => {
    const mockPool = {} as unknown as Pool
    const streamer = new AuditStreamer(mockPool)
    streamer.addStream({
      id: 'test-stream',
      destination: 'webhook',
      endpoint: 'https://example.com/hook',
      isActive: true,
    })
    const status = streamer.getStatus()
    expect(status).toHaveLength(1)
    expect(status[0].configId).toBe('test-stream')
    expect(status[0].eventsExported).toBe(0)
    expect(status[0].errorsCount).toBe(0)
    expect(status[0].destination).toBe('webhook')
  })

  it('reports correct streamCount', () => {
    const mockPool = {} as unknown as Pool
    const streamer = new AuditStreamer(mockPool)
    streamer.addStream({ id: 's1', destination: 'splunk', endpoint: 'https://a', isActive: true })
    streamer.addStream({ id: 's2', destination: 's3', endpoint: 'https://b', isActive: false })
    streamer.addStream({ id: 's3', destination: 'webhook', endpoint: 'https://c', isActive: true })
    expect(streamer.streamCount).toBe(2)
  })

  it('start and stop lifecycle works cleanly', () => {
    const mockPool = {} as unknown as Pool
    const streamer = new AuditStreamer(mockPool)
    streamer.addStream({ id: 's1', destination: 'webhook', endpoint: 'https://a', isActive: true, pollIntervalMs: 60000 })
    
    // Should not throw
    streamer.start()
    streamer.stop()

    // Double stop should be safe
    streamer.stop()
  })
})
