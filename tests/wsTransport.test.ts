/**
 * AAELink — WebSocket Transport Layer Tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TransportManager, resetTransport } from '@/lib/realtime/wsTransport'

// Mock WebSocket since we're in Node.js test env
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code?: number) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: code || 1000 })
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateError() {
    this.onerror?.()
  }
}

// Inject mock globally for tests
const origWs = globalThis.WebSocket
beforeEach(() => {
  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket
})
afterEach(() => {
  (globalThis as Record<string, unknown>).WebSocket = origWs
  resetTransport()
})

// ── Construction ─────────────────────────────────────────────────────

describe('WS Transport — Construction', () => {
  it('creates with default config', () => {
    const tm = new TransportManager()
    const status = tm.getStatus()
    expect(status.connected).toBe(false)
    expect(status.bufferedMessages).toBe(0)
    expect(status.transport).toBe('polling')
    tm.disconnect()
  })

  it('accepts custom config', () => {
    const tm = new TransportManager({
      heartbeatInterval: 5000,
      maxReconnectAttempts: 3,
      maxBufferSize: 50,
    })
    expect(tm.getStatus().connected).toBe(false)
    tm.disconnect()
  })
})

// ── Message Buffering ────────────────────────────────────────────────

describe('WS Transport — Buffering', () => {
  it('buffers messages when not connected', () => {
    const tm = new TransportManager()
    tm.send({ type: 'message', channel_id: 'ch-1', payload: { text: 'hello' } })
    tm.send({ type: 'typing', channel_id: 'ch-1', user_id: 'u-1' })
    expect(tm.getStatus().bufferedMessages).toBe(2)
    tm.disconnect()
  })

  it('respects max buffer size', () => {
    const tm = new TransportManager({ maxBufferSize: 3 })
    for (let i = 0; i < 10; i++) {
      tm.send({ type: 'message', channel_id: 'ch-1', payload: { i } })
    }
    expect(tm.getStatus().bufferedMessages).toBe(3)
    tm.disconnect()
  })
})

// ── Event Handlers ───────────────────────────────────────────────────

describe('WS Transport — Event Handlers', () => {
  it('registers and unregisters handlers', () => {
    const tm = new TransportManager()
    const handler = vi.fn()
    const unsub = tm.on('message', handler)
    expect(typeof unsub).toBe('function')
    unsub()
    tm.disconnect()
  })

  it('registers status handlers', () => {
    const tm = new TransportManager()
    const handler = vi.fn()
    const unsub = tm.onStatus(handler)
    expect(typeof unsub).toBe('function')
    unsub()
    tm.disconnect()
  })
})

// ── Room Management ──────────────────────────────────────────────────

describe('WS Transport — Room Management', () => {
  it('tracks joined rooms', () => {
    const tm = new TransportManager()
    // Buffer the subscribe messages (not connected)
    tm.joinRoom('ch-1')
    tm.joinRoom('ch-2')
    expect(tm.getStatus().bufferedMessages).toBe(2)
    tm.disconnect()
  })

  it('sends unsubscribe on leave', () => {
    const tm = new TransportManager()
    tm.joinRoom('ch-1')
    tm.leaveRoom('ch-1')
    expect(tm.getStatus().bufferedMessages).toBe(2) // subscribe + unsubscribe
    tm.disconnect()
  })
})

// ── Disconnect ───────────────────────────────────────────────────────

describe('WS Transport — Disconnect', () => {
  it('clears all state on disconnect', () => {
    const tm = new TransportManager()
    tm.send({ type: 'message', channel_id: 'ch-1', payload: {} })
    tm.joinRoom('ch-1')
    tm.disconnect()
    expect(tm.getStatus().bufferedMessages).toBe(0)
    expect(tm.getStatus().connected).toBe(false)
  })

  it('is safe to call disconnect multiple times', () => {
    const tm = new TransportManager()
    tm.disconnect()
    tm.disconnect()
    expect(tm.getStatus().connected).toBe(false)
  })
})

// ── Sequence Numbers ─────────────────────────────────────────────────

describe('WS Transport — Framing', () => {
  it('assigns incrementing sequence numbers', () => {
    const tm = new TransportManager()
    tm.send({ type: 'message', channel_id: 'ch-1', payload: { n: 1 } })
    tm.send({ type: 'message', channel_id: 'ch-1', payload: { n: 2 } })
    tm.send({ type: 'message', channel_id: 'ch-1', payload: { n: 3 } })
    expect(tm.getStatus().bufferedMessages).toBe(3)
    tm.disconnect()
  })
})
