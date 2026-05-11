/**
 * AAELink Route Tracing Middleware
 *
 * Provides a `tracedRoute()` wrapper that auto-instruments Next.js route handlers
 * with tracing spans. This approach avoids modifying existing route logic.
 *
 * Usage (in any route.ts):
 *   import { tracedRoute } from '@/lib/tracedRoute'
 *
 *   async function _GET(req: NextRequest) { ... }
 *   async function _POST(req: NextRequest) { ... }
 *
 *   export const GET  = tracedRoute('GET',  '/api/channels', _GET)
 *   export const POST = tracedRoute('POST', '/api/channels', _POST)
 */

import { NextRequest, NextResponse } from 'next/server'
import { trace } from './tracing'

/**
 * Handler that accepts NextRequest plus an optional/required context.
 * The generic default uses `any` for Next.js route export compatibility.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<C = any> = (req: NextRequest, ctx: C) => Promise<Response>

/**
 * Wrap a route handler with automatic tracing instrumentation.
 *
 * - Parses incoming `traceparent` header for distributed tracing
 * - Records HTTP method, route, status code, and latency
 * - Catches errors and marks the span as failed
 * - Adds `traceparent` header to outgoing response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tracedRoute<C = any>(
  method: string,
  routePath: string,
  handler: RouteHandler<C>
): RouteHandler<C> {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const parentCtx = trace.parseTraceparent(req.headers.get('traceparent'))
    const span = trace.startSpan(routePath, parentCtx)
    span.setAttribute('http.method', method)
    span.setAttribute('http.url', req.url)

    try {
      const response = await handler(req, ctx)

      span.setAttribute('http.status_code', response.status)
      if (response.status >= 400) {
        span.setStatus('error')
      } else {
        span.setStatus('ok')
      }

      // Inject traceparent into response for downstream correlation
      const headers = new Headers(response.headers)
      headers.set('traceparent', trace.formatTraceparent(span.context))

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (err: unknown) {
      span.setStatus('error', err)
      return NextResponse.json(
        { error: 'internal_server_error' },
        { status: 500 }
      )
    } finally {
      span.end()
    }
  }
}
