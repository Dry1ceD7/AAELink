import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/auth/session'
import { attachCsrfCookie } from '@/lib/auth/csrf'
import { loadActiveProvider } from '@/lib/auth/ssoProvider'
import { validateSamlResponse } from '@/lib/auth/ssoSamlClient'
import { consumeAuthRequest } from '@/lib/auth/ssoAuthRequest'
import { mapClaimsToIdentity } from '@/lib/auth/ssoClaims'
import { loginViaSso } from '@/lib/auth/ssoProvision'
import { auditSsoFailure, auditSsoSuccess } from '@/lib/auth/ssoAudit'
import { clientMeta, samlCallbackUrl, ssoFailure, ssoSuccess, ssoStepUp } from '@/lib/auth/ssoRouteHelpers'

/**
 * POST /api/auth/sso/saml/acs?provider=<id>
 *
 * SAML Assertion Consumer Service. Body is form-encoded { SAMLResponse,
 * RelayState }. We redeem the single-use auth-request bound to RelayState
 * (replay protection), then node-saml validates the assertion signature,
 * audience, and conditions/timing. We additionally enforce InResponseTo matches
 * the request id we issued. Then map → JIT/link → session, exactly like login.
 *
 * Response: 302 → /home (Set-Cookie session) on success, else 302 → /login.
 */
async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return ssoFailure(req)
  await ensureSchema()
  const meta = clientMeta(req)
  const providerId = new URL(req.url).searchParams.get('provider')?.trim() || ''

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'bad_body', ...meta })
    return ssoFailure(req)
  }
  const samlResponse = String(form.get('SAMLResponse') || '')
  const relayState = String(form.get('RelayState') || '')
  if (!samlResponse) {
    auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'no_response', ...meta })
    return ssoFailure(req)
  }

  // Redeem RelayState: single-use binding to our /start. Unknown/replayed ⇒ fail.
  const authReq = await consumeAuthRequest(pool, relayState)
  if (!authReq || authReq.protocol !== 'saml' || authReq.provider_id !== providerId) {
    auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'bad_relaystate', ...meta })
    return ssoFailure(req)
  }

  const cfg = await loadActiveProvider(pool, providerId, 'saml')
  if (!cfg) {
    auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'provider_inactive', ...meta })
    return ssoFailure(req)
  }

  try {
    const callbackUrl = samlCallbackUrl(req, cfg.id)
    const assertion = await validateSamlResponse(cfg, callbackUrl, samlResponse)

    // Replay/forgery defense: the assertion's InResponseTo must match the exact
    // request id we generated (== our auth-request id). Empty IdP value rejected.
    if (assertion.inResponseTo && assertion.inResponseTo !== authReq.id) {
      auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'inresponseto_mismatch', ...meta })
      return ssoFailure(req)
    }

    const identity = mapClaimsToIdentity(assertion.claims, cfg, 'nameID')
    if (!identity) {
      auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'unmappable_claims', ...meta })
      return ssoFailure(req)
    }

    const result = await loginViaSso(pool, cfg, identity, { ip: meta.ip, userAgent: meta.userAgent })
    if (!result) {
      auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'jit_disabled_no_user', ...meta })
      return ssoFailure(req)
    }

    auditSsoSuccess(pool, {
      userId: result.userId, providerId, protocol: 'saml',
      provisioned: result.provisioned, ...meta,
    })
    const res = result.mfaPending ? ssoStepUp(req) : ssoSuccess(req)
    res.cookies.set(SESSION_COOKIE, result.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: sessionCookieSecure(),
      path: '/',
      maxAge: Math.floor(result.sessionMs / 1000),
    })
    attachCsrfCookie(res)
    return res
  } catch {
    auditSsoFailure(pool, { providerId, protocol: 'saml', reason: 'assertion_invalid', ...meta })
    return ssoFailure(req)
  }
}

export const POST = tracedRoute('POST', '/api/auth/sso/saml/acs', _POST)
