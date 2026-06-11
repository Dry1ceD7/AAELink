import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { resolveDefaultOidcProviderId } from '@/lib/auth/ssoProvider'
import { ssoFailure } from '@/lib/auth/ssoRouteHelpers'

/**
 * GET /api/auth/entra — legacy entry-point shim (retired implementation).
 *
 * Historically this route hand-rolled the Entra OAuth code exchange, created
 * users with a weak-RNG username suffix, and minted a session — entirely
 * bypassing the hardened inbound-SSO stack (sso_providers + loginViaSso +
 * mfa_pending gating + JIT provisioning, ADR 0014). That implementation is
 * GONE. No token exchange, no user creation, no session minting happens here.
 *
 * The route now exists only to preserve old bookmarks / desktop clients that
 * still point at /api/auth/entra. It resolves the active OIDC provider and 302s
 * into the hardened RP flow (/api/auth/sso/oidc/start). Migration
 * 031_entra_to_sso_providers seeds a "Microsoft Entra ID" OIDC provider from any
 * enabled legacy aaelink.sso_configs row, so existing Entra tenants keep working
 * through the hardened path. When no active OIDC provider exists, we emit the
 * same generic /login?error=sso_failed redirect the rest of the SSO stack uses
 * (no failure-mode oracle).
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return ssoFailure(req)
  await ensureSchema()

  // Resolve the single active OIDC provider so the legacy entry-point can hand
  // off to the hardened RP start route. The start route also resolves this when
  // no provider is given, so we forward the id when unambiguous and otherwise
  // let start emit the same generic failure (no failure-mode oracle).
  let providerId = ''
  try {
    providerId = await resolveDefaultOidcProviderId(pool)
  } catch {
    return ssoFailure(req)
  }

  const origin = new URL(req.url).origin
  const target = new URL('/api/auth/sso/oidc/start', origin)
  if (providerId) target.searchParams.set('provider', providerId)
  return NextResponse.redirect(target)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/auth/entra', _GET)
