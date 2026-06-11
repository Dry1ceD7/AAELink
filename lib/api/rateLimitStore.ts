/**
 * Cross-replica rate limit store — audit-2026-05-26 CHG-002.
 *
 * The previous implementation lived in `middleware.ts` as a module-scope `Map`.
 * That state is per-process; behind N replicas the effective rate is N×
 * the configured limit. Auth login (10/min per IP per node) became 30/min
 * with 3 replicas — fine for legitimate users, soft on brute-force.
 *
 * This module provides a `checkLimit(key, max, windowMs)` API that prefers
 * Redis (when `REDIS_URL` is set and `ioredis` is installed) and falls back
 * to a per-process Map when Redis is unavailable.
 *
 * Redis path: INCR + EXPIRE (NX) on a per-key counter, with TTL = windowMs.
 * Fallback path: same windowed-counter shape as the original middleware.
 *
 * Determinism: the `checkLimit` function is `async`. Callers must `await`.
 * The middleware was synchronous before; the migration is straightforward.
 *
 * Edge-runtime compatibility: this module is imported by `middleware.ts`,
 * which Next.js runs on the Edge runtime. Node-only APIs (`process.stdout`,
 * `fs.*`, etc.) are forbidden here. Logging therefore goes via the universal
 * `console.warn` rather than `lib/log.ts` (which writes to stdout).
 */

/* eslint-disable no-console */

export interface RateLimitVerdict {
  ok: boolean
  retryAfterMs: number
}

interface ProcessBucket {
  count: number
  windowEnd: number
}

const processBuckets = new Map<string, ProcessBucket>()

// Sweep stale entries every 30s in environments that support setInterval.
// Edge runtime supports it; Node runtime supports it; the unref keeps it
// from holding the process open in the worker.
if (typeof globalThis !== 'undefined' && typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of processBuckets) {
      if (now >= bucket.windowEnd) processBuckets.delete(key)
    }
  }, 30_000)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
}

// ── Redis path ───────────────────────────────────────────────────────

interface IoredisLike {
  multi(): {
    incr(key: string): unknown
    pexpire(key: string, ms: number): unknown
    pttl(key: string): unknown
    exec(): Promise<Array<[Error | null, unknown]>>
  }
}

let redisClient: IoredisLike | null = null
let redisProbed = false
let redisProbing: Promise<void> | null = null

async function ensureRedis(): Promise<IoredisLike | null> {
  if (redisProbed) return redisClient
  if (redisProbing) {
    await redisProbing
    return redisClient
  }
  redisProbing = (async () => {
    const url = process.env.REDIS_URL?.trim()
    if (!url) {
      redisProbed = true
      return
    }
    try {
      // Lazy import so the dependency stays optional. The `ioredis` package
      // is not in `dependencies`; production deployments add it explicitly.
      // The specifier is held in a runtime variable so the bundler (Turbopack)
      // treats it as an external expression instead of trying to statically
      // resolve it — otherwise the Edge build emits a hard "Module not found"
      // for a dependency that is intentionally optional and absent in dev.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredisSpecifier = 'ioredis' as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (import(ioredisSpecifier).catch(() => null) as Promise<any>)
      if (!mod) {
        console.warn('[rateLimitStore.ensureRedis] redis disabled (ioredis not installed)')
        redisProbed = true
        return
      }
      // ioredis exports a default class; the dynamic import shape varies.
      const Redis = (mod as { default?: unknown; Redis?: unknown }).default
        ?? (mod as { default?: unknown; Redis?: unknown }).Redis
        ?? mod
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redisClient = new (Redis as any)(url, {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      }) as IoredisLike
    } catch (err) {
      console.warn(
        '[rateLimitStore.ensureRedis] redis init failed; using in-process fallback:',
        err instanceof Error ? err.message : String(err),
      )
      redisClient = null
    } finally {
      redisProbed = true
    }
  })()
  await redisProbing
  return redisClient
}

async function checkLimitRedis(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitVerdict> {
  const client = await ensureRedis()
  if (!client) return checkLimitInProcess(key, max, windowMs)

  try {
    const tx = client.multi()
    tx.incr(key)
    tx.pexpire(key, windowMs)
    tx.pttl(key)
    const results = await tx.exec()
    if (!results) return checkLimitInProcess(key, max, windowMs)

    const [, countRaw] = results[0] as [Error | null, number]
    const [, ttlRaw] = results[2] as [Error | null, number]
    const count = Number(countRaw) || 0
    const ttl = Number(ttlRaw) || windowMs

    if (count <= max) return { ok: true, retryAfterMs: 0 }
    return { ok: false, retryAfterMs: Math.max(ttl, 0) }
  } catch (err) {
    console.warn(
      '[rateLimitStore.checkLimitRedis] redis check failed; falling back:',
      err instanceof Error ? err.message : String(err),
    )
    return checkLimitInProcess(key, max, windowMs)
  }
}

// ── In-process path ──────────────────────────────────────────────────

function checkLimitInProcess(
  key: string,
  max: number,
  windowMs: number,
): RateLimitVerdict {
  const now = Date.now()
  const existing = processBuckets.get(key)
  if (!existing || now >= existing.windowEnd) {
    processBuckets.set(key, { count: 1, windowEnd: now + windowMs })
    return { ok: true, retryAfterMs: 0 }
  }
  existing.count += 1
  if (existing.count <= max) return { ok: true, retryAfterMs: 0 }
  return { ok: false, retryAfterMs: existing.windowEnd - now }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Check `key` against `max` requests per `windowMs`. Returns
 * `{ ok: true, retryAfterMs: 0 }` when the request is allowed and
 * `{ ok: false, retryAfterMs: <number> }` when it is rate-limited.
 *
 * Routing:
 * - `REDIS_URL` set + `ioredis` installed → Redis-backed counter (cross-replica).
 * - `REDIS_URL` unset or `ioredis` missing → in-process counter (per-replica).
 *
 * The fallback path keeps existing single-node deployments working without
 * configuration; the Redis path closes the rate-limit drift behind multiple
 * replicas (audit CHG-002).
 */
export async function checkLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitVerdict> {
  const url = process.env.REDIS_URL?.trim()
  if (url) return checkLimitRedis(`aaelink:rl:${key}`, max, windowMs)
  return checkLimitInProcess(key, max, windowMs)
}

/** Visible for testing — flush the in-process bucket cache. */
export function __resetRateLimitForTests(): void {
  processBuckets.clear()
  redisClient = null
  redisProbed = false
  redisProbing = null
}
