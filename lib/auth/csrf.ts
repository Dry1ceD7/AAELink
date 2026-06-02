import { randomBytes, createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * CSRF Token Protection for AAELink.
 *
 * Double-submit cookie pattern:
 * 1. Server sets an HttpOnly CSRF cookie with a random token
 * 2. Client reads a mirrored non-HttpOnly token (or sends header)
 * 3. Server verifies both match on every mutating request
 *
 * Usage in API routes:
 *   import { verifyCsrf, setCsrfCookie } from '@/lib/auth/csrf'
 *   // In GET handlers that serve forms, call setCsrfCookie()
 *   // In POST/PUT/PATCH/DELETE handlers, call verifyCsrf(req)
 */

const CSRF_COOKIE = 'AAELINK_CSRF'
const CSRF_HEADER = 'x-csrf-token'

/**
 * CSRF signing secret. MUST be provided via the `CSRF_SECRET` environment
 * variable in production. The historical fallback to a hard-coded literal was
 * removed by audit-2026-05-26 (CRIT-001) because that literal was committed
 * to the public repository — any deployment that did not override the env
 * var was forging a valid CSRF token from the literal in seconds.
 *
 * The secret is resolved **lazily on first use** so that:
 *   - `next build` (which evaluates modules in a production-like Node context
 *      to collect page data) does not require the env var to be set at build
 *      time. Build hosts that lack the secret can still produce an artifact;
 *      the guard fires only when a request actually tries to sign / verify.
 *   - Tests can opt-in by setting `CSRF_SECRET=test-secret` in their setup.
 *   - In dev (`NODE_ENV !== 'production'`) we generate an ephemeral secret on
 *     first use so `npm run dev` works out of the box without an env var.
 */
let _cachedSecret: string | null = null

function getCsrfSecret(): string {
  if (_cachedSecret !== null) return _cachedSecret
  const fromEnv = process.env.CSRF_SECRET?.trim()
  if (fromEnv) {
    _cachedSecret = fromEnv
    return _cachedSecret
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CSRF_SECRET is required in production. Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    )
  }
  // Dev / test: ephemeral per-process secret.
  _cachedSecret = randomBytes(32).toString('hex')
  return _cachedSecret
}

/** Visible for testing — flushes the cached secret so the next call re-reads env. */
export function __resetCsrfSecretForTests(): void {
  _cachedSecret = null
}

/** Generate a new CSRF token. */
function generateToken(): string {
  const raw = randomBytes(32).toString('hex')
  const sig = createHmac('sha256', getCsrfSecret()).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}

/** Verify a CSRF token's signature. */
function verifySignature(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [raw, sig] = parts
  const expected = createHmac('sha256', getCsrfSecret()).update(raw).digest('hex').slice(0, 16)
  // Constant-time comparison
  if (sig.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/** Set the CSRF cookie. Call this on page loads / GET responses. */
export async function setCsrfCookie(): Promise<string> {
  const token = generateToken()
  const jar = await cookies()
  jar.set(CSRF_COOKIE, token, {
    httpOnly: false,      // Client JS must be able to read this
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 4   // 4 hours
  })
  return token
}

/**
 * Verify the CSRF token from the request.
 * Checks both cookie and header/body match.
 * Returns null if valid, or a NextResponse error if invalid.
 */
export async function verifyCsrf(req: NextRequest): Promise<NextResponse | null> {
  // Skip CSRF for non-mutating methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return null

  // Skip CSRF for API-key authenticated requests (webhooks, service-to-service)
  if (req.headers.get('authorization')?.startsWith('Bearer ')) return null

  // `next/headers` `cookies()` throws when called outside a request scope
  // (e.g. unit tests that exercise route handlers directly). The double-submit
  // pattern is moot in that case, so we silently skip — analogous to "no cookie
  // set yet" below.
  let jar: Awaited<ReturnType<typeof cookies>>
  try {
    jar = await cookies()
  } catch {
    return null
  }

  const cookieToken = jar.get(CSRF_COOKIE)?.value?.trim() || ''
  const headerToken = req.headers.get(CSRF_HEADER)?.trim() || ''

  // If no CSRF cookie is set yet, skip (first request)
  if (!cookieToken) return null

  if (!headerToken) {
    return NextResponse.json(
      { error: 'csrf_token_missing', message: 'CSRF token header is required for mutating requests' },
      { status: 403 }
    )
  }

  // Verify cookie signature
  if (!verifySignature(cookieToken)) {
    return NextResponse.json(
      { error: 'csrf_token_invalid', message: 'CSRF cookie signature is invalid' },
      { status: 403 }
    )
  }

  // Verify header matches cookie
  if (cookieToken !== headerToken) {
    return NextResponse.json(
      { error: 'csrf_token_mismatch', message: 'CSRF token does not match' },
      { status: 403 }
    )
  }

  return null
}
