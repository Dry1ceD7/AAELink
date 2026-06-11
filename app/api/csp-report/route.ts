import { NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * CSP violation report sink. The Content-Security-Policy header points its
 * report endpoint here; without this route every browser CSP report POST
 * 404s and floods the console. We accept and drop the report (204). It is a
 * browser beacon that carries no session, so tracedRoute's CSRF check is a
 * no-op (verifyCsrf skips sessionless requests) and nothing is audited.
 */
async function _POST(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

async function _GET(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 })
}

export const POST = tracedRoute('POST', '/api/csp-report', _POST)
export const GET = tracedRoute('GET', '/api/csp-report', _GET)
