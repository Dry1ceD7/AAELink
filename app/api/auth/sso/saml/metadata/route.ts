import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { loadActiveProvider } from '@/lib/auth/ssoProvider'
import { generateSamlSpMetadata } from '@/lib/auth/ssoSamlClient'
import { samlCallbackUrl } from '@/lib/auth/ssoRouteHelpers'

/**
 * GET /api/auth/sso/saml/metadata?provider=<id>
 *
 * Returns the SP (Service Provider) metadata XML for the requested SAML
 * provider. IdP administrators use this document to configure the integration
 * (entityID, ACS Location, NameID format, Binding).
 *
 * Auth exception: SP metadata is intentionally public — it contains no
 * secrets and must be reachable by IdP administrators before any user session
 * exists. The entityID and ACS Location it advertises are already derivable
 * from the login flow URLs, so withholding them provides no security benefit.
 * The route still validates that the provider exists and is active, so it
 * cannot be used to enumerate inactive / non-existent provider IDs.
 *
 * Request:  query { provider: string }
 * Response: 200 application/samlmetadata+xml
 *           404 { error: 'provider_not_found' } for absent/inactive providers
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 })
  await ensureSchema()

  const providerId = new URL(req.url).searchParams.get('provider')?.trim() || ''
  const cfg = await loadActiveProvider(pool, providerId, 'saml')
  if (!cfg) return NextResponse.json({ error: 'provider_not_found' }, { status: 404 })

  try {
    const callbackUrl = samlCallbackUrl(req, cfg.id)
    const xml = generateSamlSpMetadata(cfg, callbackUrl)
    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/samlmetadata+xml' },
    })
  } catch {
    return NextResponse.json({ error: 'metadata_generation_failed' }, { status: 500 })
  }
}

export const GET = tracedRoute('GET', '/api/auth/sso/saml/metadata', _GET)
