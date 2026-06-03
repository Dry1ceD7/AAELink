import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/auth/session'
import { loadActiveProvider } from '@/lib/auth/ssoProvider'
import { completeOidcAuthz } from '@/lib/auth/ssoOidcClient'
import { consumeAuthRequest } from '@/lib/auth/ssoAuthRequest'
import { mapClaimsToIdentity } from '@/lib/auth/ssoClaims'
import { loginViaSso } from '@/lib/auth/ssoProvision'
import { auditSsoFailure, auditSsoSuccess } from '@/lib/auth/ssoAudit'
import { clientMeta, ssoFailure, ssoSuccess, ssoStepUp } from '@/lib/auth/ssoRouteHelpers'

/**
 * GET /api/auth/sso/oidc/callback?provider=<id>&code=...&state=...
 *
 * OIDC RP callback. Consumes the single-use auth-request bound to `state`
 * (CSRF + replay protection), exchanges the code, verifies the id_token via the
 * IdP JWKS (issuer/aud/exp/nonce — done inside openid-client), maps claims to a
 * user, JIT-provisions or links by email, and establishes an AAELink session
 * identical to password login. Any failure → generic /login?error=sso_failed.
 *
 * Response: 302 → /home (Set-Cookie session) on success, else 302 → /login.
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return ssoFailure(req)
  await ensureSchema()
  const meta = clientMeta(req)

  const url = new URL(req.url)
  const providerId = url.searchParams.get('provider')?.trim() || ''
  const state = url.searchParams.get('state')?.trim() || ''

  // Redeem state first: a single-use, unexpired, pending request binds this
  // callback to a /start we issued. Unknown/replayed/expired ⇒ generic failure.
  const authReq = await consumeAuthRequest(pool, state)
  if (!authReq || authReq.protocol !== 'oidc' || authReq.provider_id !== providerId) {
    auditSsoFailure(pool, { providerId, protocol: 'oidc', reason: 'bad_state', ...meta })
    return ssoFailure(req)
  }

  const cfg = await loadActiveProvider(pool, providerId, 'oidc')
  if (!cfg) {
    auditSsoFailure(pool, { providerId, protocol: 'oidc', reason: 'provider_inactive', ...meta })
    return ssoFailure(req)
  }

  try {
    const claims = await completeOidcAuthz(cfg, req.url, {
      state: authReq.state,
      nonce: authReq.nonce,
      codeVerifier: authReq.code_verifier,
    })
    const identity = mapClaimsToIdentity(claims, cfg)
    if (!identity) {
      auditSsoFailure(pool, { providerId, protocol: 'oidc', reason: 'unmappable_claims', ...meta })
      return ssoFailure(req)
    }

    const result = await loginViaSso(pool, cfg, identity, { ip: meta.ip, userAgent: meta.userAgent })
    if (!result) {
      auditSsoFailure(pool, { providerId, protocol: 'oidc', reason: 'jit_disabled_no_user', ...meta })
      return ssoFailure(req)
    }

    auditSsoSuccess(pool, {
      userId: result.userId, providerId, protocol: 'oidc',
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
    return res
  } catch {
    auditSsoFailure(pool, { providerId, protocol: 'oidc', reason: 'exchange_failed', ...meta })
    return ssoFailure(req)
  }
}

export const GET = tracedRoute('GET', '/api/auth/sso/oidc/callback', _GET)
