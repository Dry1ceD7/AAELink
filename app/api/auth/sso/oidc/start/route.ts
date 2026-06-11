import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { loadActiveProvider, resolveDefaultOidcProviderId } from '@/lib/auth/ssoProvider'
import { startOidcAuthz } from '@/lib/auth/ssoOidcClient'
import { createAuthRequest, purgeStaleAuthRequests } from '@/lib/auth/ssoAuthRequest'
import { ssoSecretKeyConfigured } from '@/lib/auth/ssoSecretCrypto'
import { oidcCallbackUrl, ssoFailure } from '@/lib/auth/ssoRouteHelpers'

/**
 * GET /api/auth/sso/oidc/start?provider=<id>
 *
 * Begins an OIDC Relying-Party login. Performs IdP discovery, builds a
 * PKCE+state+nonce authorization URL, persists state/nonce/verifier server-side
 * (single-use), and 302s the browser to the IdP. No session required — this is
 * the pre-auth entry point.
 *
 * Request:  query { provider?: string }
 *           When `provider` is omitted (e.g. the login page's generic "Sign in
 *           with Microsoft" button, or a legacy /api/auth/entra redirect), the
 *           single active OIDC provider is resolved automatically; if zero or
 *           more than one exist the request fails generically (no oracle).
 * Response: 302 → IdP authorize URL, or 302 → /login?error=sso_failed
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return ssoFailure(req)
  if (!ssoSecretKeyConfigured()) return ssoFailure(req)
  await ensureSchema()

  let providerId = new URL(req.url).searchParams.get('provider')?.trim() || ''
  if (!providerId) {
    providerId = await resolveDefaultOidcProviderId(pool)
  }
  const cfg = await loadActiveProvider(pool, providerId, 'oidc')
  if (!cfg) return ssoFailure(req)

  try {
    const redirectUri = oidcCallbackUrl(req, cfg.id)
    const started = await startOidcAuthz(cfg, redirectUri)
    await createAuthRequest(pool, {
      providerId: cfg.id,
      protocol: 'oidc',
      state: started.state,
      nonce: started.nonce,
      codeVerifier: started.codeVerifier,
      redirectUri,
    })
    purgeStaleAuthRequests(pool)
    return NextResponse.redirect(started.authorizationUrl)
  } catch {
    return ssoFailure(req)
  }
}

export const GET = tracedRoute('GET', '/api/auth/sso/oidc/start', _GET)
