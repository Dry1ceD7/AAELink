import { NextRequest, NextResponse } from 'next/server'
import { checkLimit } from '@/lib/api/rateLimitStore'
import { applySecurityHeaders, generateNonce } from '@/lib/auth/csp'

/**
 * Next.js Edge Middleware — Request-level guardrails.
 *
 * - CORS for API routes
 * - Security headers including CSP (audit-2026-05-26 CHG-004)
 * - Rate limiting via Redis-backed cross-replica store (audit CHG-002)
 * - Request ID injection
 *
 * Pre-CHG-002 history: rate limiting lived in a module-scope `Map`. Behind
 * N replicas the effective rate was N× the configured limit. The Redis
 * store added in `lib/rateLimitStore.ts` closes that gap; the in-process
 * Map is the fallback when `REDIS_URL` is unset or `ioredis` is absent.
 */

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // ── Request ID ──
  const requestId = crypto.randomUUID()
  response.headers.set('X-Request-Id', requestId)

  // ── Security headers + CSP (CHG-004) ──
  // CSP needs `'unsafe-inline'` in `style-src` for now because Tiptap and
  // existing inline-style hits (CHG-005) still rely on it. The
  // inline-style sweep removes that need before v0.1.0.
  const nonce = generateNonce()
  applySecurityHeaders(response, nonce, {
    allowUnsafeInlineStyles: true,
    enableHsts: process.env.NODE_ENV === 'production',
  })

  // ── CORS for API routes ──
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin') || ''
    const allowedOrigins = (process.env.CORS_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean)

    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      response.headers.set('Access-Control-Allow-Origin', origin || '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, x-csrf-token')
      response.headers.set('Access-Control-Max-Age', '86400')
    }

    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: response.headers })
    }

    // ── Rate limiting (API routes only) ──
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    for (const rule of RATE_LIMIT_RULES) {
      if (rule.pattern.test(pathname)) {
        const key = `${ip}:${pathname}`
        const { ok, retryAfterMs } = await checkLimit(key, rule.maxRequests, rule.windowMs)

        if (!ok) {
          const denied = NextResponse.json(
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
          // Re-apply security headers on the denial response so CSP still applies.
          return applySecurityHeaders(denied, nonce, { allowUnsafeInlineStyles: true })
        }

        response.headers.set('X-RateLimit-Limit', String(rule.maxRequests))
        break
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
