/**
 * `lib/wsGateway/protocol.ts` — frame schema and parser.
 *
 * The WS gateway uses a small JSON envelope so the existing `PubSubEvent` from
 * `lib/redisPubSub.ts` can travel over the wire without rewrapping. These
 * tests pin the schema; the gateway router and the boot script both depend on
 * the parser staying well-defined for malformed input.
 */
import { describe, it, expect } from 'vitest'
import {
  parseClientFrame,
  serializeServerFrame,
  type ClientFrame,
  type ServerFrame,
} from '@/lib/realtime/wsGateway/protocol'

describe('wsGateway/protocol — parseClientFrame', () => {
  it('parses a subscribe frame', () => {
    const f = parseClientFrame('{"type":"subscribe","channel_id":"ch-1"}')
    expect(f).toEqual<ClientFrame>({ type: 'subscribe', channel_id: 'ch-1' })
  })

  it('parses an unsubscribe frame', () => {
    const f = parseClientFrame('{"type":"unsubscribe","channel_id":"ch-1"}')
    expect(f).toEqual<ClientFrame>({ type: 'unsubscribe', channel_id: 'ch-1' })
  })

  it('parses a ping frame', () => {
    const f = parseClientFrame('{"type":"ping"}')
    expect(f).toEqual<ClientFrame>({ type: 'ping' })
  })

  it('returns null for malformed JSON', () => {
    expect(parseClientFrame('not json')).toBeNull()
  })

  it('returns null for an unknown type', () => {
    expect(parseClientFrame('{"type":"hack"}')).toBeNull()
  })

  it('returns null for missing channel_id on subscribe', () => {
    expect(parseClientFrame('{"type":"subscribe"}')).toBeNull()
  })

  it('returns null for non-string channel_id', () => {
    expect(parseClientFrame('{"type":"subscribe","channel_id":42}')).toBeNull()
  })

  it('returns null for empty channel_id', () => {
    expect(parseClientFrame('{"type":"subscribe","channel_id":""}')).toBeNull()
  })

  it('drops unknown extra fields silently', () => {
    const f = parseClientFrame(
      '{"type":"subscribe","channel_id":"ch-1","extra":"ignored","nested":{"a":1}}'
    )
    expect(f).toEqual<ClientFrame>({ type: 'subscribe', channel_id: 'ch-1' })
  })

  // ── Topic-keyed subscribe/unsubscribe (ADR-0002) ──────────────────

  it('parses a topic-only subscribe frame', () => {
    const f = parseClientFrame('{"type":"subscribe","topic":"global:presence"}')
    expect(f).toEqual<ClientFrame>({ type: 'subscribe', topic: 'global:presence' })
  })

  it('rejects a subscribe with both channel_id and topic', () => {
    expect(
      parseClientFrame(
        '{"type":"subscribe","channel_id":"ch-1","topic":"global:presence"}'
      )
    ).toBeNull()
  })

  it('rejects a subscribe with neither channel_id nor topic', () => {
    expect(parseClientFrame('{"type":"subscribe"}')).toBeNull()
  })

  it('preserves since on a topic-only subscribe', () => {
    const f = parseClientFrame(
      '{"type":"subscribe","topic":"global:presence","since":"cursor-1"}'
    )
    expect(f).toEqual<ClientFrame>({
      type: 'subscribe',
      topic: 'global:presence',
      since: 'cursor-1',
    })
  })

  it('parses a topic-only unsubscribe frame', () => {
    const f = parseClientFrame('{"type":"unsubscribe","topic":"global:presence"}')
    expect(f).toEqual<ClientFrame>({ type: 'unsubscribe', topic: 'global:presence' })
  })

  it('rejects unsubscribe with both channel_id and topic, and rejects unsubscribe with neither', () => {
    expect(
      parseClientFrame(
        '{"type":"unsubscribe","channel_id":"ch-1","topic":"global:presence"}'
      )
    ).toBeNull()
    expect(parseClientFrame('{"type":"unsubscribe"}')).toBeNull()
  })
})

describe('wsGateway/protocol — serializeServerFrame', () => {
  it('serializes an event frame', () => {
    const out = serializeServerFrame({
      type: 'event',
      topic: 'channel:ch-1',
      id: 'evt-1',
      payload: { type: 'message', channel_id: 'ch-1', payload: { id: 'p1' } },
    })
    const parsed = JSON.parse(out) as ServerFrame
    expect(parsed.type).toBe('event')
    if (parsed.type === 'event') {
      expect(parsed.topic).toBe('channel:ch-1')
      expect(parsed.id).toBe('evt-1')
      // narrow on the inner union — `message` events carry channel_id
      if (parsed.payload.type === 'message') {
        expect(parsed.payload.channel_id).toBe('ch-1')
      }
    }
  })

  it('serializes a pong frame', () => {
    const out = serializeServerFrame({ type: 'pong' })
    expect(JSON.parse(out)).toEqual({ type: 'pong' })
  })

  it('serializes an error frame', () => {
    const out = serializeServerFrame({
      type: 'error',
      code: 'unauthorized',
      message: 'Session expired',
    })
    expect(JSON.parse(out)).toEqual({
      type: 'error',
      code: 'unauthorized',
      message: 'Session expired',
    })
  })

  it('serializes a hello frame with userId', () => {
    const out = serializeServerFrame({ type: 'hello', user_id: 'u-1' })
    expect(JSON.parse(out)).toEqual({ type: 'hello', user_id: 'u-1' })
  })
})
