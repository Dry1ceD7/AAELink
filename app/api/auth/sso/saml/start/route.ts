import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { loadActiveProvider } from '@/lib/auth/ssoProvider'
import { buildSamlAuthnUrl } from '@/lib/auth/ssoSamlClient'
import { createAuthRequest, purgeStaleAuthRequests } from '@/lib/auth/ssoAuthRequest'
import { samlCallbackUrl, ssoFailure } from '@/lib/auth/ssoRouteHelpers'

/**
 * GET /api/auth/sso/saml/start?provider=<id>
 *
 * SP-initiated SAML login. Generates a RelayState, persists it server-side
 * (single-use) so the ACS can bind the response back to this request, builds a
 * redirect-binding AuthnRequest URL, and 302s the browser to the IdP.
 *
 * Request:  query { provider: string }
 * Response: 302 → IdP SSO URL, or 302 → /login?error=sso_failed
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return ssoFailure(req)
  await ensureSchema()

  const providerId = new URL(req.url).searchParams.get('provider')?.trim() || ''
  const cfg = await loadActiveProvider(pool, providerId, 'saml')
  if (!cfg) return ssoFailure(req)

  try {
    const callbackUrl = samlCallbackUrl(req, cfg.id)
    const relayState = randomUUID()
    await createAuthRequest(pool, {
      providerId: cfg.id,
      protocol: 'saml',
      state: relayState,
      relayState,
      redirectUri: callbackUrl,
    })
    const authnUrl = await buildSamlAuthnUrl(cfg, callbackUrl, relayState)
    purgeStaleAuthRequests(pool)
    return NextResponse.redirect(authnUrl)
  } catch {
    return ssoFailure(req)
  }
}

export const GET = tracedRoute('GET', '/api/auth/sso/saml/start', _GET)
