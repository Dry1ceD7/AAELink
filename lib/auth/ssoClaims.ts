import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'

/**
 * Pure claim → user-profile mapping for inbound SSO.
 *
 * Takes a flat bag of IdP claims (OIDC id_token claims or SAML assertion
 * attributes) plus the provider's attribute_mapping, and produces a normalized
 * profile. No I/O, no provisioning decisions — kept pure so it is exhaustively
 * unit-testable and cannot leak. The caller decides JIT vs. link.
 */

export interface MappedIdentity {
  subject: string
  email: string
  firstName: string
  lastName: string
  displayName: string
  groups: string[]
}

function pick(claims: Record<string, unknown>, key: string): string {
  if (!key) return ''
  const v = claims[key]
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim()
  return ''
}

function pickGroups(claims: Record<string, unknown>, key: string): string[] {
  if (!key) return []
  const v = claims[key]
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v) return v.split(/[,\s]+/).filter(Boolean)
  return []
}

/**
 * Map raw claims to a normalized identity. Returns null when no subject or no
 * email can be resolved — both are required to safely link or provision a user.
 */
export function mapClaimsToIdentity(
  claims: Record<string, unknown>,
  cfg: Pick<SsoProviderConfig, 'attributeMapping'>,
  subjectClaimFallback = 'sub'
): MappedIdentity | null {
  const m = cfg.attributeMapping || {}

  const subject =
    pick(claims, m.subject || '') ||
    pick(claims, subjectClaimFallback) ||
    pick(claims, 'sub') ||
    pick(claims, 'nameID')
  const email = (
    pick(claims, m.email || 'email') ||
    pick(claims, 'email') ||
    pick(claims, 'upn') ||
    pick(claims, 'userPrincipalName')
  ).toLowerCase()

  if (!subject || !email || !email.includes('@')) return null

  const firstName =
    pick(claims, m.first_name || 'given_name') || pick(claims, 'givenName')
  const lastName =
    pick(claims, m.last_name || 'family_name') || pick(claims, 'surname')
  const displayName =
    pick(claims, m.name || 'name') ||
    `${firstName} ${lastName}`.trim() ||
    email.split('@')[0]
  const groups = pickGroups(claims, m.groups || 'groups')

  return { subject, email, firstName, lastName, displayName, groups }
}

/**
 * Resolve the AAELink role from IdP groups using the provider's group→role map.
 * Never returns an elevated platform role: SSO JIT must not auto-grant admin.
 * The result is a *workspace* member role and is clamped to a safe allow-list.
 */
export function resolveWorkspaceRole(
  identity: Pick<MappedIdentity, 'groups'>,
  cfg: Pick<SsoProviderConfig, 'groupRoleMapping' | 'defaultRole'>
): string {
  const SAFE = new Set(['member', 'guest'])
  const map = cfg.groupRoleMapping || {}
  for (const g of identity.groups) {
    const mapped = map[g]
    if (mapped && SAFE.has(mapped)) return mapped
  }
  const fallback = cfg.defaultRole || 'member'
  return SAFE.has(fallback) ? fallback : 'member'
}
