import * as oidc from 'openid-client'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'

/**
 * Thin wrapper over openid-client v6 (functional API) for the inbound
 * Relying-Party flow. We perform OIDC discovery against the IdP's issuer,
 * build a PKCE+state+nonce authorization URL, and exchange the code while the
 * library verifies the id_token signature against the IdP JWKS, the issuer,
 * audience, expiry, and our expected state/nonce. Discovered Configurations are
 * cached per issuer to avoid re-fetching metadata/JWKS on every request.
 */

const configCache = new Map<string, { config: oidc.Configuration; at: number }>()
const CONFIG_TTL_MS = 60 * 60 * 1000 // 1h — JWKS rotation tolerated by the lib's cache

function issuerUrl(cfg: SsoProviderConfig): URL {
  const raw = cfg.discoveryUrl || cfg.issuer
  if (!raw) throw new Error('sso_issuer_unset')
  // Accept either a bare issuer or a full .well-known URL; discovery() wants the issuer.
  return new URL(raw.replace(/\/\.well-known\/openid-configuration\/?$/, ''))
}

async function getConfiguration(cfg: SsoProviderConfig): Promise<oidc.Configuration> {
  const key = `${cfg.id}:${cfg.discoveryUrl || cfg.issuer}`
  const cached = configCache.get(key)
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.config
  const config = await oidc.discovery(
    issuerUrl(cfg),
    cfg.clientId,
    cfg.clientSecret || undefined
  )
  configCache.set(key, { config, at: Date.now() })
  return config
}

export interface StartedAuthz {
  authorizationUrl: string
  state: string
  nonce: string
  codeVerifier: string
}

export async function startOidcAuthz(
  cfg: SsoProviderConfig,
  redirectUri: string
): Promise<StartedAuthz> {
  const config = await getConfiguration(cfg)
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: cfg.scopes || 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  })

  return { authorizationUrl: url.href, state, nonce, codeVerifier }
}

/**
 * Exchange the authorization code at the callback. The library validates the
 * id_token (signature via JWKS, issuer, audience, exp, nonce) and the state.
 * Returns the flattened id_token claims, or throws on any validation failure —
 * callers must convert the throw into a generic auth error.
 */
export async function completeOidcAuthz(
  cfg: SsoProviderConfig,
  currentUrl: string,
  expected: { state: string; nonce: string; codeVerifier: string }
): Promise<Record<string, unknown>> {
  const config = await getConfiguration(cfg)
  const tokens = await oidc.authorizationCodeGrant(config, new URL(currentUrl), {
    expectedState: expected.state,
    expectedNonce: expected.nonce,
    pkceCodeVerifier: expected.codeVerifier,
  })
  const claims = tokens.claims()
  if (!claims) throw new Error('sso_no_id_token')
  return claims as unknown as Record<string, unknown>
}
