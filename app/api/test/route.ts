import { NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'
import pkg from '../../../package.json' with { type: 'json' }

/**
 * API Test — Slack api.test parity.
 *
 * GET  /api/test — basic connectivity test
 * POST /api/test — echo test with request data
 *
 * Returns: { ok: true, version, timestamp } — confirms API is reachable.
 *
 * The version field is read from package.json so it stays in lockstep with
 * release notes and never drifts the way it did before v0.0.22.
 */
async function _GET() {
  return NextResponse.json({
    ok: true,
    api: 'AAELink',
    version: `v${pkg.version}`,
    timestamp: Date.now(),
  })
}

async function _POST() {
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/test', _GET)
export const POST   = tracedRoute('POST', '/api/test', _POST)
