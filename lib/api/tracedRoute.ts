/**
 * AAELink Route Tracing & Discipline Middleware
 *
 * Provides a `tracedRoute()` wrapper that auto-instruments Next.js route handlers
 * with three concerns:
 *
 *   1. Distributed tracing — parses `traceparent`, opens a span, records http
 *      method / url / status, propagates the span id back in the response.
 *   2. CSRF verification — for any mutating verb (POST / PUT / PATCH / DELETE)
 *      runs `verifyCsrf` and short-circuits with the 403 it returns. Closes the
 *      audit finding from `docs/audit-2026-05-15.md` (only 12 / 236 routes had
 *      explicit CSRF checks; with this lift, every wrapped mutation is
 *      protected automatically).
 *   3. Audit log — for every successful or failed mutation, writes a structured
 *      `http.<method>.<route>` entry with status / latency / ip / user-agent /
 *      error. CSRF rejections are NOT audited (already a 403 metric — auditing
 *      would explode the table on a token leak).
 *
 * Usage in any route.ts:
 *
 *   async function _GET(req: NextRequest) { ... }
 *   async function _POST(req: NextRequest) { ... }
 *
 *   export const GET  = tracedRoute('GET',  '/api/channels', _GET)
 *   export const POST = tracedRoute('POST', '/api/channels', _POST)
 *
 * The wrapper is the single chokepoint. Handlers that already call
 * `verifyCsrf` / `writeAuditLog` directly will end up double-checking, which
 * is harmless (CSRF returns null on the second pass; audit-log writes two
 * entries — see `metadata.source` to distinguish).
 */

import { NextRequest, NextResponse } from 'next/server'
import { trace } from '@/lib/infra/tracing'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { getPool } from '@/lib/infra/db'
import { enforceIpAllowlist } from '@/lib/auth/ipAccessGate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<C = any> = (req: NextRequest, ctx: C) => Promise<Response>

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Routes exempt from IP-allowlist enforcement (Admin parity §31). Two classes:
 *  1. Lockout-prevention: admin/ip-access MUST stay reachable so an admin whose
 *     IP is not on a misconfigured allowlist can still log in and fix it —
 *     otherwise a bad allowlist bricks the only console that repairs it.
 *  2. Public unauthenticated endpoints that must stay reachable regardless of
 *     the allowlist: health/ping, the inbound webhook receiver, and SSO/SAML/
 *     OIDC callbacks (the IdP/external callers are not the users it scopes).
 * Matched by prefix against the canonical routePath (covers dynamic segments).
 */
const IP_ALLOWLIST_EXEMPT_PREFIXES: string[] = [
  '/api/admin/ip-access',   // lockout-prevention: admins must reach the fix
  '/api/health',
  '/api/ping',
  '/api/webhooks',          // inbound receiver /api/webhooks/[token]
  '/api/auth/sso',          // SAML/OIDC start + ACS/callback + metadata/refresh
]

function isIpAllowlistExempt(routePath: string): boolean {
  return IP_ALLOWLIST_EXEMPT_PREFIXES.some(p => routePath.startsWith(p))
}

/** Build a stable audit-log action key from the route path. */
function actionKey(method: string, routePath: string): string {
  // /api/channels/[id]/messages → http.post.api.channels.id.messages
  const slug = routePath
    .replace(/^\/+/, '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/[^a-zA-Z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
  return `http.${method.toLowerCase()}.${slug}`
}

/**
 * Wrap a route handler with automatic tracing, CSRF, and audit-log behavior.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tracedRoute<C = any>(
  method: string,
  routePath: string,
  handler: RouteHandler<C>
): RouteHandler<C> {
  const isMutation = MUTATING_METHODS.has(method.toUpperCase())

  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const startedAt = Date.now()
    const parentCtx = trace.parseTraceparent(req.headers.get('traceparent'))
    const span = trace.startSpan(routePath, parentCtx)
    span.setAttribute('http.method', method)
    span.setAttribute('http.url', req.url)

    // ── IP allowlist: enforce the admin/ip-access config (parity §31) ──
    // Edge middleware cannot read the DB-backed config; this Node-runtime
    // chokepoint can. Exempt the ip-access console (lockout-prevention) and
    // public unauthenticated endpoints.
    if (!isIpAllowlistExempt(routePath)) {
      const ipDenied = await enforceIpAllowlist(req, routePath)
      if (ipDenied) {
        span.setAttribute('http.status_code', ipDenied.status)
        span.setStatus('error')
        span.end()
        const headers = new Headers(ipDenied.headers)
        headers.set('traceparent', trace.formatTraceparent(span.context))
        return new Response(ipDenied.body, {
          status: ipDenied.status,
          statusText: ipDenied.statusText,
          headers,
        })
      }
    }

    // ── CSRF: short-circuit before the handler runs ────────────────────
    if (isMutation) {
      const csrfFail = await verifyCsrf(req)
      if (csrfFail) {
        span.setAttribute('http.status_code', csrfFail.status)
        span.setStatus('error')
        span.end()
        // Inject traceparent on the rejection so the client can correlate.
        const headers = new Headers(csrfFail.headers)
        headers.set('traceparent', trace.formatTraceparent(span.context))
        return new Response(csrfFail.body, {
          status: csrfFail.status,
          statusText: csrfFail.statusText,
          headers,
        })
      }
    }

    let response: Response | null = null
    let threw: unknown = null

    try {
      response = await handler(req, ctx)

      span.setAttribute('http.status_code', response.status)
      if (response.status >= 400) {
        span.setStatus('error')
      } else {
        span.setStatus('ok')
      }

      // Inject traceparent into response for downstream correlation.
      const headers = new Headers(response.headers)
      headers.set('traceparent', trace.formatTraceparent(span.context))
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })

      return response
    } catch (err: unknown) {
      threw = err
      span.setStatus('error', err)
      response = NextResponse.json(
        { error: 'internal_server_error' },
        { status: 500 }
      )
      return response
    } finally {
      span.end()

      // ── Audit log: every mutation, success or failure (CSRF rejects skipped above) ─
      if (isMutation) {
        const status = response?.status ?? 500
        const latencyMs = Date.now() - startedAt
        try {
          const pool = getPool()
          if (pool) {
            writeAuditLog({
              pool,
              action: actionKey(method, routePath),
              ipAddress: extractIp(req),
              userAgent: req.headers.get('user-agent') || '',
              metadata: {
                method,
                route: routePath,
                status,
                latency_ms: latencyMs,
                success: status >= 200 && status < 400,
                ...(threw ? { error: String((threw as Error)?.message || threw) } : {}),
              },
            })
          }
        } catch {
          // Audit-log failures must never break the request path.
        }
      }
    }
  }
}
