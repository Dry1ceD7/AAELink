/**
 * AAELink Webhook Dead-Letter Queue
 *
 * Persistent retry system for failed webhook deliveries:
 *   - Exponential backoff with jitter (1s → 2s → 4s → 8s → 16s → 32s)
 *   - Max 6 retry attempts before dead-lettering
 *   - Dead-letter storage for manual inspection and replay
 *   - Delivery status tracking (pending → delivering → delivered → failed → dead)
 *   - Batch processing with configurable concurrency
 *   - Circuit breaker per endpoint (auto-disable after N consecutive failures)
 */

// ── Types ────────────────────────────────────────────────────────────

export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead'

export interface WebhookDelivery {
  id: string
  webhook_id: string
  endpoint_url: string
  payload: string
  status: DeliveryStatus
  attempts: number
  max_attempts: number
  last_attempt_at: number
  next_retry_at: number
  last_error: string
  created_at: number
  delivered_at: number
  dead_at: number
  response_status: number
  response_body: string
}

export interface DlqConfig {
  /** Max retry attempts before dead-lettering (default: 6) */
  maxAttempts: number
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs: number
  /** Max delay cap in ms (default: 32000) */
  maxDelayMs: number
  /** Max concurrent deliveries (default: 5) */
  concurrency: number
  /** Request timeout in ms (default: 10000) */
  timeoutMs: number
  /** Consecutive failures before circuit opens (default: 10) */
  circuitBreakerThreshold: number
  /** Circuit breaker cooldown in ms (default: 300000 = 5 min) */
  circuitBreakerCooldownMs: number
}

export interface CircuitState {
  endpoint: string
  consecutiveFailures: number
  isOpen: boolean
  openedAt: number
  lastFailureAt: number
}

export interface DlqStats {
  pending: number
  delivering: number
  delivered: number
  failed: number
  dead: number
  total: number
  circuitBreakers: CircuitState[]
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_DLQ_CONFIG: DlqConfig = {
  maxAttempts: 6,
  baseDelayMs: 1000,
  maxDelayMs: 32000,
  concurrency: 5,
  timeoutMs: 10000,
  circuitBreakerThreshold: 10,
  circuitBreakerCooldownMs: 300000,
}

// ── Backoff Calculator ───────────────────────────────────────────────

/** Calculate next retry delay with exponential backoff + jitter */
export function calculateRetryDelay(
  attempt: number,
  config: DlqConfig = DEFAULT_DLQ_CONFIG
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt)
  const capped = Math.min(exponential, config.maxDelayMs)
  // Add ±25% jitter to prevent thundering herd
  const jitter = capped * 0.25 * (Math.random() * 2 - 1)
  return Math.round(capped + jitter)
}

/** Calculate the next retry timestamp */
export function nextRetryAt(
  attempt: number,
  config: DlqConfig = DEFAULT_DLQ_CONFIG
): number {
  return Date.now() + calculateRetryDelay(attempt, config)
}

// ── Circuit Breaker ──────────────────────────────────────────────────

export class WebhookCircuitBreaker {
  private circuits = new Map<string, CircuitState>()
  private config: DlqConfig

  constructor(config: Partial<DlqConfig> = {}) {
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config }
  }

  /** Record a delivery success — reset circuit */
  recordSuccess(endpoint: string): void {
    this.circuits.set(endpoint, {
      endpoint,
      consecutiveFailures: 0,
      isOpen: false,
      openedAt: 0,
      lastFailureAt: 0,
    })
  }

  /** Record a delivery failure — may trip circuit */
  recordFailure(endpoint: string): void {
    const current = this.circuits.get(endpoint) || {
      endpoint,
      consecutiveFailures: 0,
      isOpen: false,
      openedAt: 0,
      lastFailureAt: 0,
    }

    current.consecutiveFailures++
    current.lastFailureAt = Date.now()

    if (current.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      current.isOpen = true
      current.openedAt = Date.now()
    }

    this.circuits.set(endpoint, current)
  }

  /** Check if endpoint is currently blocked by circuit breaker */
  isBlocked(endpoint: string): boolean {
    const circuit = this.circuits.get(endpoint)
    if (!circuit || !circuit.isOpen) return false

    // Check if cooldown has passed (half-open → allow retry)
    if (Date.now() - circuit.openedAt > this.config.circuitBreakerCooldownMs) {
      circuit.isOpen = false
      circuit.consecutiveFailures = 0
      this.circuits.set(endpoint, circuit)
      return false
    }

    return true
  }

  /** Get all circuit states */
  getStates(): CircuitState[] {
    return Array.from(this.circuits.values())
  }

  /** Reset a specific circuit */
  resetCircuit(endpoint: string): void {
    this.circuits.delete(endpoint)
  }

  /** Reset all circuits */
  resetAll(): void {
    this.circuits.clear()
  }
}

// ── In-Memory DLQ (for testing & small deployments) ──────────────────

export class WebhookDLQ {
  private queue = new Map<string, WebhookDelivery>()
  private circuitBreaker: WebhookCircuitBreaker
  private config: DlqConfig
  private processing = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<DlqConfig> = {}) {
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config }
    this.circuitBreaker = new WebhookCircuitBreaker(this.config)
  }

  /** Enqueue a delivery for processing */
  enqueue(delivery: Omit<WebhookDelivery, 'status' | 'attempts' | 'last_attempt_at' | 'next_retry_at' | 'last_error' | 'delivered_at' | 'dead_at' | 'response_status' | 'response_body'>): void {
    const full: WebhookDelivery = {
      ...delivery,
      status: 'pending',
      attempts: 0,
      max_attempts: this.config.maxAttempts,
      last_attempt_at: 0,
      next_retry_at: Date.now(),
      last_error: '',
      delivered_at: 0,
      dead_at: 0,
      response_status: 0,
      response_body: '',
    }
    this.queue.set(delivery.id, full)
  }

  /** Process all pending deliveries that are ready */
  async processQueue(deliverFn?: (d: WebhookDelivery) => Promise<{ status: number; body: string }>): Promise<number> {
    if (this.processing) return 0
    this.processing = true

    const now = Date.now()
    const ready = Array.from(this.queue.values())
      .filter(d => (d.status === 'pending' || d.status === 'failed') && d.next_retry_at <= now)
      .slice(0, this.config.concurrency)

    let processed = 0

    for (const delivery of ready) {
      // Check circuit breaker
      if (this.circuitBreaker.isBlocked(delivery.endpoint_url)) {
        continue
      }

      delivery.status = 'delivering'
      delivery.attempts++
      delivery.last_attempt_at = now

      try {
        const result = deliverFn
          ? await deliverFn(delivery)
          : await this.defaultDeliver(delivery)

        delivery.response_status = result.status
        delivery.response_body = result.body.slice(0, 1000)

        if (result.status >= 200 && result.status < 300) {
          delivery.status = 'delivered'
          delivery.delivered_at = Date.now()
          this.circuitBreaker.recordSuccess(delivery.endpoint_url)
        } else {
          throw new Error(`HTTP ${result.status}: ${result.body.slice(0, 200)}`)
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        delivery.last_error = errMsg

        this.circuitBreaker.recordFailure(delivery.endpoint_url)

        if (delivery.attempts >= delivery.max_attempts) {
          delivery.status = 'dead'
          delivery.dead_at = Date.now()
        } else {
          delivery.status = 'failed'
          delivery.next_retry_at = nextRetryAt(delivery.attempts, this.config)
        }
      }

      this.queue.set(delivery.id, delivery)
      processed++
    }

    this.processing = false
    return processed
  }

  /** Default HTTP delivery */
  private async defaultDeliver(delivery: WebhookDelivery): Promise<{ status: number; body: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const res = await fetch(delivery.endpoint_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: delivery.payload,
        signal: controller.signal,
      })
      const body = await res.text()
      return { status: res.status, body }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Get delivery by ID */
  getDelivery(id: string): WebhookDelivery | undefined {
    return this.queue.get(id)
  }

  /** Get all dead-lettered deliveries */
  getDeadLetters(): WebhookDelivery[] {
    return Array.from(this.queue.values()).filter(d => d.status === 'dead')
  }

  /** Replay a dead-lettered delivery */
  replay(id: string): boolean {
    const d = this.queue.get(id)
    if (!d || d.status !== 'dead') return false
    d.status = 'pending'
    d.attempts = 0
    d.next_retry_at = Date.now()
    d.dead_at = 0
    d.last_error = ''
    this.queue.set(id, d)
    return true
  }

  /** Get queue statistics */
  getStats(): DlqStats {
    const all = Array.from(this.queue.values())
    return {
      pending: all.filter(d => d.status === 'pending').length,
      delivering: all.filter(d => d.status === 'delivering').length,
      delivered: all.filter(d => d.status === 'delivered').length,
      failed: all.filter(d => d.status === 'failed').length,
      dead: all.filter(d => d.status === 'dead').length,
      total: all.length,
      circuitBreakers: this.circuitBreaker.getStates(),
    }
  }

  /** Purge delivered/dead items older than maxAge ms */
  purge(maxAgeMs: number = 86400000): number {
    const cutoff = Date.now() - maxAgeMs
    let purged = 0
    for (const [id, d] of this.queue) {
      if ((d.status === 'delivered' && d.delivered_at < cutoff) ||
          (d.status === 'dead' && d.dead_at < cutoff)) {
        this.queue.delete(id)
        purged++
      }
    }
    return purged
  }

  /** Start auto-processing on interval */
  startProcessor(intervalMs: number = 5000, deliverFn?: (d: WebhookDelivery) => Promise<{ status: number; body: string }>): void {
    this.stopProcessor()
    this.timer = setInterval(() => this.processQueue(deliverFn), intervalMs)
  }

  /** Stop auto-processing */
  stopProcessor(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Get circuit breaker instance */
  getCircuitBreaker(): WebhookCircuitBreaker {
    return this.circuitBreaker
  }
}
