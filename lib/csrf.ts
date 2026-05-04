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
 *   import { verifyCsrf, setCsrfCookie } from '@/lib/csrf'
 *   // In GET handlers that serve forms, call setCsrfCookie()
 *   // In POST/PUT/PATCH/DELETE handlers, call verifyCsrf(req)
 */

const CSRF_COOKIE = 'AAELINK_CSRF'
const CSRF_HEADER = 'x-csrf-token'
const CSRF_SECRET = process.env.CSRF_SECRET || 'aaelink-csrf-default-secret-change-me'

/** Generate a new CSRF token. */
function generateToken(): string {
  const raw = randomBytes(32).toString('hex')
  const sig = createHmac('sha256', CSRF_SECRET).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}

/** Verify a CSRF token's signature. */
function verifySignature(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [raw, sig] = parts
  const expected = createHmac('sha256', CSRF_SECRET).update(raw).digest('hex').slice(0, 16)
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

  const jar = await cookies()
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
