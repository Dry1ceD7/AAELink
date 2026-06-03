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
  samlAudience: string
  isActive: boolean
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
  saml_audience: string
  is_active: boolean
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
            saml_entry_point, saml_idp_cert, saml_audience, is_active
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
    samlAudience: r.saml_audience || '',
    isActive: r.is_active,
    clientSecret,
  }
}
