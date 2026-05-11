import { NextRequest, NextResponse } from 'next/server'

/**
 * Next.js Edge Middleware — Request-level guardrails.
 *
 * This middleware runs on every request before hitting route handlers.
 * It provides:
 *   1. CORS headers for API routes
 *   2. Security headers (CSP, HSTS, X-Frame-Options, etc.)
 *   3. IP-based rate limiting for auth routes (login, register, account-request)
 *   4. Request ID injection for traceability
 */

/* ── Rate limit store (in-memory, edge-compatible) ─────────────────────── */

const rateBuckets = new Map<string, { count: number; windowEnd: number }>()

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now()
  const existing = rateBuckets.get(key)

  if (!existing || now >= existing.windowEnd) {
    rateBuckets.set(key, { count: 1, windowEnd: now + windowMs })
    return { ok: true, retryAfterMs: 0 }
  }

  existing.count += 1
  if (existing.count <= maxRequests) {
    return { ok: true, retryAfterMs: 0 }
  }

  return { ok: false, retryAfterMs: existing.windowEnd - now }
}

// Sweep stale entries every 30s
if (typeof globalThis !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of rateBuckets) {
      if (now >= bucket.windowEnd) rateBuckets.delete(key)
    }
  }, 30_000)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref()
  }
}

/* ── Rate limit tiers ──────────────────────────────────────────────────── */

interface RateLimitRule {
  pattern: RegExp
  maxRequests: number
  windowMs: number
}

const RATE_LIMIT_RULES: RateLimitRule[] = [
  // Auth endpoints — strict (prevent brute-force)
  { pattern: /^\/api\/auth\/login$/,           maxRequests: 10,  windowMs: 60_000 },
  { pattern: /^\/api\/auth\/register$/,        maxRequests: 5,   windowMs: 60_000 },
  { pattern: /^\/api\/auth\/account-request$/, maxRequests: 5,   windowMs: 60_000 },
  // Message posting — moderate
  { pattern: /^\/api\/messages$/,              maxRequests: 30,  windowMs: 10_000 },
  // File uploads — moderate
  { pattern: /^\/api\/files$/,                 maxRequests: 20,  windowMs: 60_000 },
  { pattern: /^\/api\/documents$/,             maxRequests: 15,  windowMs: 60_000 },
  // Search — prevent abuse
  { pattern: /^\/api\/messages\/search$/,      maxRequests: 15,  windowMs: 10_000 },
  { pattern: /^\/api\/search\//,               maxRequests: 20,  windowMs: 10_000 },
  // Webhooks — moderate
  { pattern: /^\/api\/webhooks\//,             maxRequests: 60,  windowMs: 60_000 },
  // General API — permissive fallback
  { pattern: /^\/api\//,                       maxRequests: 120, windowMs: 60_000 },
]

/* ── Middleware handler ────────────────────────────────────────────────── */

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // ── Request ID ──
  const requestId = crypto.randomUUID()
  response.headers.set('X-Request-Id', requestId)

  // ── Security headers ──
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  )

  // Only set HSTS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    )
  }

  // ── CORS for API routes ──
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin') || ''
    const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)

    // Allow same-origin and configured origins
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      response.headers.set('Access-Control-Allow-Origin', origin || '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id')
      response.headers.set('Access-Control-Max-Age', '86400')
    }

    // Preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: response.headers
      })
    }

    // ── Rate limiting (API routes only) ──
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    for (const rule of RATE_LIMIT_RULES) {
      if (rule.pattern.test(pathname)) {
        // For auth routes use IP, for others use IP + session approximation
        const key = `${ip}:${pathname}`
        const { ok, retryAfterMs } = checkRateLimit(key, rule.maxRequests, rule.windowMs)

        if (!ok) {
          return NextResponse.json(
            {
              error: 'rate_limited',
              message: 'Too many requests. Please try again later.',
              retry_after_ms: retryAfterMs
            },
            {
              status: 429,
              headers: {
                'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
                'X-RateLimit-Limit': String(rule.maxRequests),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.ceil((Date.now() + retryAfterMs) / 1000)),
                'X-Request-Id': requestId,
              }
            }
          )
        }

        // Set rate limit headers on successful requests
        response.headers.set('X-RateLimit-Limit', String(rule.maxRequests))
        break // Apply first matching rule only
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files (images, fonts)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)).*)',
  ],
}
