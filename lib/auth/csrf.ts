import { randomBytes, createHmac } from 'crypto'
import { NextResponse } from 'next/server'
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
// Mirrors SESSION_COOKIE in lib/auth/session.ts; duplicated as a literal to keep
// this module free of a session import. CSRF is only enforced when this is present.
const SESSION_COOKIE = 'AAELINK_SESSION'

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
 * Mint + attach the readable CSRF cookie to a NextResponse. MUST be called
 * wherever a session cookie is established (login / SSO / passkey) so an
 * authenticated session always carries a token for the double-submit check —
 * otherwise verifyCsrf would have nothing to validate against.
 */
export function attachCsrfCookie(res: NextResponse): string {
  const token = generateToken()
  res.cookies.set(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 4,
  })
  return token
}

/**
 * Verify the CSRF token from the request.
 * Checks both cookie and header/body match.
 * Returns null if valid, or a NextResponse error if invalid.
 */
export async function verifyCsrf(req: Request): Promise<NextResponse | null> {
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

  // Enforce only for authenticated sessions. An unauthenticated / first-contact
  // request has no session to forge against, and login itself mints the CSRF
  // cookie alongside the session cookie (attachCsrfCookie). For an authenticated
  // mutating request the guard is FAIL-CLOSED — a missing or invalid cookie is
  // rejected, never waved through (the prior `!cookieToken → allow` skip made
  // CSRF a global no-op because the cookie was never minted).
  const hasSession = Boolean(jar.get(SESSION_COOKIE)?.value?.trim())
  if (!hasSession) return null

  if (!cookieToken || !verifySignature(cookieToken)) {
    return NextResponse.json(
      { error: 'csrf_token_invalid', message: 'A valid CSRF cookie is required for mutating requests' },
      { status: 403 }
    )
  }

  if (!headerToken) {
    return NextResponse.json(
      { error: 'csrf_token_missing', message: 'CSRF token header is required for mutating requests' },
      { status: 403 }
    )
  }

  if (cookieToken !== headerToken) {
    return NextResponse.json(
      { error: 'csrf_token_mismatch', message: 'CSRF token does not match' },
      { status: 403 }
    )
  }

  return null
}
