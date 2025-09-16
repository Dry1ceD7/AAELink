/**
 * Rate Limiting Middleware
 * Protect against abuse with Redis-backed rate limiting
 */

import { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { redis } from '../services/redis';

export interface RateLimitOptions {
  windowMs: number;     // Time window in milliseconds
  maxRequests: number;  // Maximum requests per window
  message?: string;     // Custom error message
  keyGenerator?: (c: Context) => string; // Custom key generator
  skipSuccessfulRequests?: boolean;      // Don't count successful requests
  skipFailedRequests?: boolean;          // Don't count failed requests
}

/**
 * Rate limit middleware factory
 */
export const rateLimit = (options: RateLimitOptions) => {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
    keyGenerator = defaultKeyGenerator,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  return createMiddleware(async (c: Context, next: Next) => {
    const key = keyGenerator(c);
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Clean old entries and get current count
      await redis.zremrangebyscore(key, 0, windowStart);
      const currentCount = await redis.zcard(key);

      // Check if limit exceeded
      if (currentCount >= maxRequests) {
        // Get time until window resets
        const oldestEntry = await redis.zrange(key, 0, 0, 'WITHSCORES');
        const resetTime = oldestEntry.length > 0
          ? parseInt(oldestEntry[1] as string) + windowMs
          : now + windowMs;

        c.header('X-RateLimit-Limit', maxRequests.toString());
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', Math.ceil(resetTime / 1000).toString());
        c.header('Retry-After', Math.ceil((resetTime - now) / 1000).toString());

        return c.json({ error: message }, 429);
      }

      // Record this request
      const shouldCount = await new Promise<boolean>((resolve) => {
        const originalNext = next;
        let counted = false;

        // Wrap next to check response status
        const wrappedNext = async () => {
          await originalNext();

          if (!counted) {
            const status = c.res.status;
            const isSuccessful = status >= 200 && status < 300;
            const isFailed = status >= 400;

            if (
              (!skipSuccessfulRequests || !isSuccessful) &&
              (!skipFailedRequests || !isFailed)
            ) {
              resolve(true);
            } else {
              resolve(false);
            }
            counted = true;
          }
        };

        // Call wrapped next
        wrappedNext().catch(() => resolve(true)); // Count errors by default
      });

      if (shouldCount) {
        await redis.zadd(key, now, `${now}-${Math.random()}`);
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }

      // Add rate limit headers
      const remaining = Math.max(0, maxRequests - currentCount - (shouldCount ? 1 : 0));
      c.header('X-RateLimit-Limit', maxRequests.toString());
      c.header('X-RateLimit-Remaining', remaining.toString());
      c.header('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000).toString());

    } catch (error) {
      console.error('Rate limiting error:', error);
      // Continue without rate limiting on error
      await next();
    }
  });
};

/**
 * Default key generator (IP-based)
 */
function defaultKeyGenerator(c: Context): string {
  const forwarded = c.req.header('X-Forwarded-For');
  const ip = forwarded ? forwarded.split(',')[0].trim() :
             c.req.header('X-Real-IP') ||
             'unknown';
  return `rate_limit:${ip}`;
}

/**
 * User-based key generator
 */
export function userKeyGenerator(c: Context): string {
  const session = c.get('session');
  if (session) {
    return `rate_limit:user:${session.userId}`;
  }
  return defaultKeyGenerator(c);
}

/**
 * Endpoint-specific key generator
 */
export function endpointKeyGenerator(endpoint: string) {
  return (c: Context): string => {
    const baseKey = userKeyGenerator(c);
    return `${baseKey}:${endpoint}`;
  };
}

/**
 * Pre-configured rate limiters
 */

// General API rate limit
export const apiRateLimit = () => rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 1000,        // 1000 requests per 15 minutes
  keyGenerator: userKeyGenerator,
});

// Authentication rate limit
export const authRateLimit = () => rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,          // 10 attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later',
  keyGenerator: endpointKeyGenerator('auth'),
});

// Message sending rate limit
export const messageRateLimit = () => rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 60,          // 60 messages per minute
  message: 'Message rate limit exceeded, please slow down',
  keyGenerator: userKeyGenerator,
  skipFailedRequests: true, // Don't count failed message attempts
});

// File upload rate limit
export const uploadRateLimit = () => rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 100,         // 100 uploads per hour
  message: 'Upload rate limit exceeded, please try again later',
  keyGenerator: userKeyGenerator,
});

// WebSocket connection rate limit
export const wsConnectionRateLimit = () => rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 10,          // 10 connection attempts per minute
  message: 'WebSocket connection rate limit exceeded',
  keyGenerator: defaultKeyGenerator,
});

// Search rate limit
export const searchRateLimit = () => rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  maxRequests: 30,          // 30 searches per minute
  message: 'Search rate limit exceeded, please try again later',
  keyGenerator: userKeyGenerator,
});

/**
 * Get rate limit info for a key
 */
export async function getRateLimitInfo(key: string, windowMs: number, maxRequests: number) {
  try {
    const now = Date.now();
    const windowStart = now - windowMs;

    await redis.zremrangebyscore(key, 0, windowStart);
    const currentCount = await redis.zcard(key);
    const remaining = Math.max(0, maxRequests - currentCount);

    return {
      limit: maxRequests,
      used: currentCount,
      remaining,
      resetTime: now + windowMs,
    };
  } catch (error) {
    console.error('Failed to get rate limit info:', error);
    return {
      limit: maxRequests,
      used: 0,
      remaining: maxRequests,
      resetTime: Date.now() + windowMs,
    };
  }
}

/**
 * Reset rate limit for a key
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    console.error('Failed to reset rate limit:', error);
  }
}

/**
 * Combined rate limit middleware for common use cases
 */
export const rateLimitMiddleware = () => {
  return createMiddleware(async (c: Context, next: Next) => {
    const path = c.req.path;

    // Apply specific rate limits based on path
    if (path.startsWith('/api/auth/')) {
      return authRateLimit()(c, next);
    } else if (path.startsWith('/api/messages')) {
      return messageRateLimit()(c, next);
    } else if (path.startsWith('/api/files/upload')) {
      return uploadRateLimit()(c, next);
    } else if (path.startsWith('/api/search')) {
      return searchRateLimit()(c, next);
    } else {
      return apiRateLimit()(c, next);
    }
  });
};
