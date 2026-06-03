import { SAML, type SamlConfig, type Profile } from '@node-saml/node-saml'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'

/**
 * Thin wrapper over @node-saml/node-saml for the SP (Service Provider) side of
 * inbound SAML SSO. node-saml performs the security-critical validation on the
 * assertion: XML signature against the IdP cert, audience restriction, and the
 * NotBefore/NotOnOrAfter conditions. We additionally bind InResponseTo to our
 * own single-use auth-request store at the route layer (replay protection).
 *
 * We disable node-saml's own InResponseTo cache (validateInResponseTo: never)
 * because our sso_auth_requests table is the single source of truth for
 * outstanding request IDs across processes; the route checks it explicitly.
 */

function buildSaml(cfg: SsoProviderConfig, callbackUrl: string): SAML {
  if (!cfg.samlIdpCert) throw new Error('saml_idp_cert_unset')
  if (!cfg.samlEntryPoint) throw new Error('saml_entry_point_unset')
  // SP entity id ("issuer" in node-saml terms): prefer the configured audience,
  // fall back to the callback origin so a value always exists.
  const spIssuer = cfg.samlAudience || new URL(callbackUrl).origin
  const options: SamlConfig = {
    callbackUrl,
    entryPoint: cfg.samlEntryPoint,
    issuer: spIssuer,
    idpCert: cfg.samlIdpCert,
    audience: cfg.samlAudience || spIssuer,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: 'never' as SamlConfig['validateInResponseTo'],
    acceptedClockSkewMs: 5000,
    disableRequestedAuthnContext: true,
  }
  return new SAML(options)
}

export async function buildSamlAuthnUrl(
  cfg: SsoProviderConfig,
  callbackUrl: string,
  relayState: string
): Promise<string> {
  const saml = buildSaml(cfg, callbackUrl)
  return saml.getAuthorizeUrlAsync(relayState, undefined, {})
}

export interface SamlAssertion {
  claims: Record<string, unknown>
  inResponseTo: string
}

/**
 * Validate a posted SAMLResponse. Throws on any signature / audience / timing
 * failure (node-saml enforces these). Returns the flattened attribute claims
 * plus the InResponseTo so the route can match it to our auth-request store.
 */
export async function validateSamlResponse(
  cfg: SsoProviderConfig,
  callbackUrl: string,
  samlResponse: string
): Promise<SamlAssertion> {
  const saml = buildSaml(cfg, callbackUrl)
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse })
  if (!profile) throw new Error('saml_no_profile')
  return { claims: flattenProfile(profile), inResponseTo: extractInResponseTo(profile) }
}

function extractInResponseTo(profile: Profile): string {
  const v = (profile as Record<string, unknown>).inResponseTo
  return typeof v === 'string' ? v : ''
}

/** Flatten a node-saml Profile into a plain claim bag for mapClaimsToIdentity. */
function flattenProfile(profile: Profile): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(profile)) {
    if (typeof v === 'function') continue
    out[k] = v
  }
  // Normalize common identifiers so attribute_mapping defaults resolve.
  out.nameID = profile.nameID
  out.sub = profile.nameID
  if (profile.email || profile.mail) out.email = profile.email || profile.mail
  return out
}
