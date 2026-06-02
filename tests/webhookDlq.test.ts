/**
 * AAELink — Webhook Dead-Letter Queue Tests
 *
 * Validates backoff calculation, circuit breaker, DLQ lifecycle,
 * replay, purge, and stats.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  calculateRetryDelay,
  nextRetryAt,
  WebhookCircuitBreaker,
  WebhookDLQ,
  DEFAULT_DLQ_CONFIG,
} from '@/lib/webhooks/webhookDlq'

// ── Backoff ──────────────────────────────────────────────────────────

describe('Webhook DLQ — Backoff', () => {
  it('calculates exponential delays', () => {
    const d0 = calculateRetryDelay(0, { ...DEFAULT_DLQ_CONFIG, baseDelayMs: 1000 })
    const d1 = calculateRetryDelay(1, { ...DEFAULT_DLQ_CONFIG, baseDelayMs: 1000 })
    const d2 = calculateRetryDelay(2, { ...DEFAULT_DLQ_CONFIG, baseDelayMs: 1000 })
    // With jitter, values should be approximately 1000, 2000, 4000 (±25%)
    expect(d0).toBeGreaterThan(700)
    expect(d0).toBeLessThan(1300)
    expect(d1).toBeGreaterThan(1400)
    expect(d1).toBeLessThan(2600)
    expect(d2).toBeGreaterThan(2800)
    expect(d2).toBeLessThan(5200)
  })

  it('caps delay at maxDelayMs', () => {
    const d = calculateRetryDelay(20, { ...DEFAULT_DLQ_CONFIG, maxDelayMs: 5000 })
    expect(d).toBeLessThanOrEqual(6250) // 5000 + 25% jitter
  })

  it('nextRetryAt returns future timestamp', () => {
    const ts = nextRetryAt(0)
    expect(ts).toBeGreaterThan(Date.now() - 100) // allow small timing drift
  })
})

// ── Circuit Breaker ──────────────────────────────────────────────────

describe('Webhook DLQ — Circuit Breaker', () => {
  let cb: WebhookCircuitBreaker

  beforeEach(() => {
    cb = new WebhookCircuitBreaker({ circuitBreakerThreshold: 3, circuitBreakerCooldownMs: 1000 })
  })

  it('starts with circuit closed', () => {
    expect(cb.isBlocked('http://example.com')).toBe(false)
  })

  it('opens circuit after threshold failures', () => {
    cb.recordFailure('http://example.com')
    cb.recordFailure('http://example.com')
    expect(cb.isBlocked('http://example.com')).toBe(false)
    cb.recordFailure('http://example.com') // 3rd failure = threshold
    expect(cb.isBlocked('http://example.com')).toBe(true)
  })

  it('resets circuit on success', () => {
    cb.recordFailure('http://example.com')
    cb.recordFailure('http://example.com')
    cb.recordSuccess('http://example.com')
    cb.recordFailure('http://example.com')
    expect(cb.isBlocked('http://example.com')).toBe(false)
  })

  it('tracks independent circuits per endpoint', () => {
    cb.recordFailure('http://a.com')
    cb.recordFailure('http://a.com')
    cb.recordFailure('http://a.com')
    expect(cb.isBlocked('http://a.com')).toBe(true)
    expect(cb.isBlocked('http://b.com')).toBe(false)
  })

  it('resets specific circuit', () => {
    cb.recordFailure('http://a.com')
    cb.recordFailure('http://a.com')
    cb.recordFailure('http://a.com')
    cb.resetCircuit('http://a.com')
    expect(cb.isBlocked('http://a.com')).toBe(false)
  })

  it('returns circuit states', () => {
    cb.recordFailure('http://a.com')
    const states = cb.getStates()
    expect(states).toHaveLength(1)
    expect(states[0].endpoint).toBe('http://a.com')
    expect(states[0].consecutiveFailures).toBe(1)
  })
})

// ── DLQ Lifecycle ────────────────────────────────────────────────────

describe('Webhook DLQ — Queue', () => {
  let dlq: WebhookDLQ

  beforeEach(() => {
    dlq = new WebhookDLQ({ maxAttempts: 3 })
  })

  it('enqueues deliveries as pending', () => {
    dlq.enqueue({ id: 'd1', webhook_id: 'w1', endpoint_url: 'http://x.com', payload: '{}', created_at: Date.now(), max_attempts: 3 })
    const stats = dlq.getStats()
    expect(stats.pending).toBe(1)
    expect(stats.total).toBe(1)
  })

  it('processes queue with custom delivery function', async () => {
    dlq.enqueue({ id: 'd1', webhook_id: 'w1', endpoint_url: 'http://x.com', payload: '{}', created_at: Date.now(), max_attempts: 3 })
    const processed = await dlq.processQueue(async () => ({ status: 200, body: 'ok' }))
    expect(processed).toBe(1)
    expect(dlq.getStats().delivered).toBe(1)
  })

  it('retries on failure', async () => {
    dlq.enqueue({ id: 'd1', webhook_id: 'w1', endpoint_url: 'http://x.com', payload: '{}', created_at: Date.now(), max_attempts: 3 })
    await dlq.processQueue(async () => { throw new Error('timeout') })
    const d = dlq.getDelivery('d1')!
    expect(d.status).toBe('failed')
    expect(d.attempts).toBe(1)
    expect(d.last_error).toContain('timeout')
  })

  it('dead-letters after max attempts', async () => {
    dlq.enqueue({ id: 'd1', webhook_id: 'w1', endpoint_url: 'http://x.com', payload: '{}', created_at: Date.now(), max_attempts: 3 })
    const failFn = async () => { throw new Error('fail') }

    for (let i = 0; i < 3; i++) {
      // Override next_retry_at so it processes immediately
      const d = dlq.getDelivery('d1')!
      d.next_retry_at = 0
      await dlq.processQueue(failFn)
    }

    expect(dlq.getDelivery('d1')!.status).toBe('dead')
    expect(dlq.getDeadLetters()).toHaveLength(1)
  })

  it('replays dead-lettered delivery', async () => {
    dlq.enqueue({ id: 'd1', webhook_id: 'w1', endpoint_url: 'http://x.com', payload: '{}', created_at: Date.now(), max_attempts: 3 })
    for (let i = 0; i < 3; i++) {
      const d = dlq.getDelivery('d1')!; d.next_retry_at = 0
      await dlq.processQueue(async () => { throw new Error('fail') })
    }

    expect(dlq.replay('d1')).toBe(true)
    expect(dlq.getDelivery('d1')!.status).toBe('pending')
    expect(dlq.getDelivery('d1')!.attempts).toBe(0)
  })

  it('purges old delivered items', async () => {
    dlq.enqueue({ id: 'd1', webhook_id: 'w1', endpoint_url: 'http://x.com', payload: '{}', created_at: Date.now(), max_attempts: 3 })
    await dlq.processQueue(async () => ({ status: 200, body: 'ok' }))

    // Force delivery timestamp to old
    const d = dlq.getDelivery('d1')!
    d.delivered_at = Date.now() - 200000
    const purged = dlq.purge(100000)
    expect(purged).toBe(1)
  })

  it('stopProcessor is safe to call multiple times', () => {
    dlq.startProcessor(60000)
    dlq.stopProcessor()
    dlq.stopProcessor()
  })
})
