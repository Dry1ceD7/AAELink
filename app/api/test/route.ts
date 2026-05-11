import { NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * API Test — Slack api.test parity.
 *
 * GET  /api/test — basic connectivity test
 * POST /api/test — echo test with request data
 *
 * Returns: { ok: true } — confirms API is reachable.
 */
async function _GET() {
  return NextResponse.json({
    ok: true,
    api: 'AAELink',
    version: 'v0.0.8-alpha',
    timestamp: Date.now(),
  })
}

async function _POST() {
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/test', _GET)
export const POST   = tracedRoute('POST', '/api/test', _POST)
