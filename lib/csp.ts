/**
 * AAELink Content Security Policy Middleware
 *
 * Generates and enforces CSP headers with per-request nonce injection
 * to prevent XSS, clickjacking, and data injection attacks.
 *
 * Features:
 *   - Strict CSP directives with nonce-based script/style allowlisting
 *   - Report-only mode for rollout safety
 *   - Violation reporting endpoint integration
 *   - HSTS, X-Frame-Options, X-Content-Type-Options headers
 *   - Configurable policy per environment
 */

import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'

// ── Types ────────────────────────────────────────────────────────────

export interface CspConfig {
  reportOnly?: boolean
  reportUri?: string
  /** Additional trusted script sources (e.g., CDN domains) */
  trustedScriptSrcs?: string[]
  /** Additional trusted style sources */
  trustedStyleSrcs?: string[]
  /** Additional trusted connect sources (e.g., API endpoints, WebSocket) */
  trustedConnectSrcs?: string[]
  /** Additional trusted image sources */
  trustedImgSrcs?: string[]
  /** Additional trusted font sources */
  trustedFontSrcs?: string[]
  /** Allow unsafe-eval (for dev only) */
  allowUnsafeEval?: boolean
  /** Allow inline styles without nonce (for legacy compatibility) */
  allowUnsafeInlineStyles?: boolean
  /** Frame ancestors — who can embed this page */
  frameAncestors?: string[]
  /** Enable HSTS header */
  enableHsts?: boolean
  /** HSTS max-age in seconds (default: 1 year) */
  hstsMaxAge?: number
}

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<CspConfig> = {
  reportOnly: false,
  reportUri: '/api/csp-report',
  trustedScriptSrcs: [],
  trustedStyleSrcs: ['https://fonts.googleapis.com'],
  trustedConnectSrcs: [],
  trustedImgSrcs: ['data:', 'blob:'],
  trustedFontSrcs: ['https://fonts.gstatic.com'],
  allowUnsafeEval: false,
  allowUnsafeInlineStyles: false,
  frameAncestors: ["'self'"],
  enableHsts: true,
  hstsMaxAge: 31536000, // 1 year
}

// ── Nonce ─────────────────────────────────────────────────────────────

/** Generate a cryptographically random nonce */
export function generateNonce(): string {
  return randomBytes(16).toString('base64')
}

// ── Policy Builder ───────────────────────────────────────────────────

/** Build CSP directive string from config and nonce */
export function buildCspPolicy(nonce: string, config: CspConfig = {}): string {
  const c = { ...DEFAULT_CONFIG, ...config }

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(c.allowUnsafeEval ? ["'unsafe-eval'"] : []),
    ...c.trustedScriptSrcs,
  ].join(' ')

  const styleSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    ...(c.allowUnsafeInlineStyles ? ["'unsafe-inline'"] : []),
    ...c.trustedStyleSrcs,
  ].join(' ')

  const connectSrc = [
    "'self'",
    'wss:',  // WebSocket connections
    ...c.trustedConnectSrcs,
  ].join(' ')

  const imgSrc = [
    "'self'",
    ...c.trustedImgSrcs,
  ].join(' ')

  const fontSrc = [
    "'self'",
    ...c.trustedFontSrcs,
  ].join(' ')

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `connect-src ${connectSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors ${c.frameAncestors.join(' ')}`,
    `upgrade-insecure-requests`,
  ]

  if (c.reportUri) {
    directives.push(`report-uri ${c.reportUri}`)
  }

  return directives.join('; ')
}

// ── Security Headers ─────────────────────────────────────────────────

/** Apply all security headers to a response */
export function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
  config: CspConfig = {}
): NextResponse {
  const c = { ...DEFAULT_CONFIG, ...config }
  const policy = buildCspPolicy(nonce, config)

  // CSP header
  const headerName = c.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy'
  response.headers.set(headerName, policy)

  // Standard security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '0')  // Deprecated but good for older browsers
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  // HSTS
  if (c.enableHsts) {
    response.headers.set(
      'Strict-Transport-Security',
      `max-age=${c.hstsMaxAge}; includeSubDomains; preload`
    )
  }

  return response
}

// ── Middleware Helper ─────────────────────────────────────────────────

/**
 * CSP middleware wrapper — injects nonce into request headers
 * and applies security headers to the response.
 *
 * Usage in middleware.ts:
 *   import { withCsp } from '@/lib/csp'
 *   export function middleware(req: NextRequest) {
 *     return withCsp(req)
 *   }
 */
export function withCsp(
  req: NextRequest,
  config: CspConfig = {}
): NextResponse {
  const nonce = generateNonce()

  // Forward nonce to server components via request header
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  return applySecurityHeaders(response, nonce, config)
}

// ── Violation Report Handler ─────────────────────────────────────────

export interface CspViolationReport {
  'csp-report'?: {
    'document-uri'?: string
    referrer?: string
    'violated-directive'?: string
    'effective-directive'?: string
    'original-policy'?: string
    'blocked-uri'?: string
    'status-code'?: number
    'source-file'?: string
    'line-number'?: number
    'column-number'?: number
  }
}

/** Parse and log a CSP violation report */
export function parseCspReport(body: CspViolationReport): {
  directive: string
  blockedUri: string
  sourceFile: string
  lineNumber: number
} | null {
  const report = body['csp-report']
  if (!report) return null

  return {
    directive: report['effective-directive'] || report['violated-directive'] || 'unknown',
    blockedUri: report['blocked-uri'] || 'unknown',
    sourceFile: report['source-file'] || 'unknown',
    lineNumber: report['line-number'] || 0,
  }
}
