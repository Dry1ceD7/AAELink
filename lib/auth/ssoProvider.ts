import type { Pool } from 'pg'
import { decryptSecret } from '@/lib/auth/ssoSecretCrypto'

/**
 * Typed loader for an SSO IdP configuration row (aaelink.sso_providers).
 *
 * Reuses the rows the existing /api/auth/sso config route manages. The client
 * secret is read from the recoverable `client_secret_enc` column (added in
 * migration 022) and decrypted in-process; the legacy `client_secret_hash`
 * column is intentionally ignored for the RP flow since it is not recoverable.
 */

export interface SsoProviderConfig {
  id: string
  name: string
  type: 'oidc' | 'saml' | 'oauth2'
  issuer: string
  discoveryUrl: string
  clientId: string
  scopes: string
  jitProvisioning: boolean
  defaultRole: string
  defaultWorkspaceId: string | null
  attributeMapping: Record<string, string>
  groupRoleMapping: Record<string, string>
  samlEntryPoint: string
  samlIdpCert: string
  /** All IdP signing certs (cert rotation); empty ⇒ fall back to samlIdpCert. */
  samlIdpCerts: string[]
  samlAudience: string
  isActive: boolean
  /** When true, a session from this provider requires MFA step-up before use. */
  enforceMfa: boolean
  /** Decrypted client secret, or '' when none stored. Never log this. */
  clientSecret: string
}

interface Row {
  id: string
  name: string
  type: string
  issuer: string
  discovery_url: string
  client_id: string
  client_secret_enc: string
  scopes: string
  jit_provisioning: boolean
  default_role: string
  default_workspace_id: string | null
  attribute_mapping: unknown
  group_role_mapping: unknown
  saml_entry_point: string
  saml_idp_cert: string
  saml_idp_certs: unknown
  saml_audience: string
  is_active: boolean
  enforce_mfa: boolean
}

/** Coerce the saml_idp_certs JSONB column into a clean string[]. */
function asCertArray(v: unknown): string[] {
  const raw = typeof v === 'string' ? safeJsonArray(v) : v
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

function safeJsonArray(s: string): unknown {
  try { return JSON.parse(s) } catch { return [] }
}

function asMap(v: unknown): Record<string, string> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val
    }
    return out
  }
  return {}
}

/**
 * Resolve the id of the single active OIDC/oauth2 provider, for entry points
 * that don't carry an explicit `provider` query param (the login page's "Sign in
 * with Microsoft" button, the retired /api/auth/entra shim). Returns '' when
 * none exist OR when more than one exists — an ambiguous pick must not silently
 * route a user to the wrong IdP, so callers treat '' as a generic failure.
 * Entra-seeded providers (name 'Microsoft Entra ID') are preferred only as a
 * tie-break among providers of the same age; ambiguity still yields ''.
 */
export async function resolveDefaultOidcProviderId(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id
       FROM aaelink.sso_providers
      WHERE is_active = true
        AND type IN ('oidc', 'oauth2')
      ORDER BY (name = 'Microsoft Entra ID') DESC, created_at ASC
      LIMIT 2`
  )
  if (rows.length !== 1) return ''
  return rows[0]?.id || ''
}

export async function loadActiveProvider(
  pool: Pool,
  providerId: string,
  expectedType: 'oidc' | 'saml'
): Promise<SsoProviderConfig | null> {
  if (!providerId) return null
  const { rows } = await pool.query<Row>(
    `SELECT id, name, type, issuer, discovery_url, client_id, client_secret_enc,
            scopes, jit_provisioning, default_role, default_workspace_id,
            attribute_mapping, group_role_mapping,
            saml_entry_point, saml_idp_cert, saml_idp_certs, saml_audience, is_active, enforce_mfa
       FROM aaelink.sso_providers
      WHERE id = $1`,
    [providerId]
  )
  const r = rows[0]
  if (!r || !r.is_active) return null
  // oauth2 rows ride the oidc path (generic OAuth2 with OIDC discovery).
  const normalizedType = r.type === 'saml' ? 'saml' : 'oidc'
  if (expectedType === 'saml' && normalizedType !== 'saml') return null
  if (expectedType === 'oidc' && normalizedType !== 'oidc') return null

  let clientSecret = ''
  if (r.client_secret_enc) {
    try {
      clientSecret = decryptSecret(r.client_secret_enc)
    } catch {
      clientSecret = ''
    }
  }

  return {
    id: r.id,
    name: r.name,
    type: normalizedType,
    issuer: r.issuer || '',
    discoveryUrl: r.discovery_url || '',
    clientId: r.client_id || '',
    scopes: r.scopes || 'openid profile email',
    jitProvisioning: r.jit_provisioning !== false,
    defaultRole: r.default_role || 'member',
    defaultWorkspaceId: r.default_workspace_id || null,
    attributeMapping: asMap(r.attribute_mapping),
    groupRoleMapping: asMap(r.group_role_mapping),
    samlEntryPoint: r.saml_entry_point || '',
    samlIdpCert: r.saml_idp_cert || '',
    samlIdpCerts: asCertArray(r.saml_idp_certs),
    samlAudience: r.saml_audience || '',
    isActive: r.is_active,
    enforceMfa: r.enforce_mfa === true,
    clientSecret,
  }
}
