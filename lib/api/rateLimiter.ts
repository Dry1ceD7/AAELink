/**
 * In-process sliding-window rate limiter.
 *
 * Each key (typically `userId:action`) is bucketed into 1-second windows.
 * Suitable for Next.js API routes running in a single Node.js process.
 * For multi-instance deployments behind a load balancer, swap the
 * in-memory map for a Redis INCR + EXPIRE implementation.
 *
 * Usage:
 *   const limiter = getRateLimiter()
 *   const { ok, retryAfterMs } = limiter.check(`${uid}:message.post`, 10, 5_000)
 *   if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } })
 */

interface Bucket {
  count:     number;
  windowEnd: number; // ms epoch when the current window expires
}

class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Sweep stale buckets every 60 s to prevent unbounded memory growth.
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref(); // don't block process exit
  }

  /**
   * @param key          Unique key, e.g. `${userId}:message.post`
   * @param maxRequests  Max allowed calls within `windowMs`
   * @param windowMs     Sliding window length in ms (default 5 000)
   * @returns `{ ok: true }` or `{ ok: false, retryAfterMs: number }`
   */
  check(
    key: string,
    maxRequests: number,
    windowMs = 5_000
  ): { ok: boolean; retryAfterMs: number } {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now >= existing.windowEnd) {
      // Start a fresh window.
      this.buckets.set(key, { count: 1, windowEnd: now + windowMs });
      return { ok: true, retryAfterMs: 0 };
    }

    existing.count += 1;
    if (existing.count <= maxRequests) {
      return { ok: true, retryAfterMs: 0 };
    }

    return { ok: false, retryAfterMs: existing.windowEnd - now };
  }

  private sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.windowEnd) this.buckets.delete(key);
    }
  }
}

// Module-level singleton — one instance per Node.js worker process.
let _limiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!_limiter) _limiter = new RateLimiter();
  return _limiter;
}
