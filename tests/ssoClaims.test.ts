/**
 * AAELink — Inbound SSO claim→user mapping + role resolution tests.
 */
import { describe, it, expect } from 'vitest'
import { mapClaimsToIdentity, resolveWorkspaceRole } from '@/lib/auth/ssoClaims'

const baseCfg = { attributeMapping: {} as Record<string, string> }

describe('ssoClaims — mapClaimsToIdentity', () => {
  it('maps standard OIDC claims', () => {
    const id = mapClaimsToIdentity(
      { sub: 'okta|123', email: 'Jane.Doe@Corp.com', given_name: 'Jane', family_name: 'Doe', name: 'Jane Doe' },
      baseCfg
    )
    expect(id).not.toBeNull()
    expect(id!.subject).toBe('okta|123')
    expect(id!.email).toBe('jane.doe@corp.com') // lowercased
    expect(id!.firstName).toBe('Jane')
    expect(id!.lastName).toBe('Doe')
    expect(id!.displayName).toBe('Jane Doe')
  })

  it('honors custom attribute_mapping', () => {
    const id = mapClaimsToIdentity(
      { user_id: 'u-9', mail: 'a@b.com', fn: 'A', ln: 'B', grp: ['admins'] },
      { attributeMapping: { subject: 'user_id', email: 'mail', first_name: 'fn', last_name: 'ln', groups: 'grp' } }
    )
    expect(id!.subject).toBe('u-9')
    expect(id!.email).toBe('a@b.com')
    expect(id!.groups).toEqual(['admins'])
  })

  it('falls back to nameID for SAML subject', () => {
    const id = mapClaimsToIdentity(
      { nameID: 'saml-name', email: 'x@y.com' },
      baseCfg,
      'nameID'
    )
    expect(id!.subject).toBe('saml-name')
  })

  it('splits a comma/space-delimited groups string', () => {
    const id = mapClaimsToIdentity(
      { sub: 's', email: 'e@e.com', groups: 'a, b c' },
      baseCfg
    )
    expect(id!.groups).toEqual(['a', 'b', 'c'])
  })

  it('returns null when subject missing', () => {
    expect(mapClaimsToIdentity({ email: 'e@e.com' }, baseCfg)).toBeNull()
  })

  it('returns null when email missing', () => {
    expect(mapClaimsToIdentity({ sub: 's' }, baseCfg)).toBeNull()
  })

  it('returns null when email malformed (no @)', () => {
    expect(mapClaimsToIdentity({ sub: 's', email: 'not-an-email' }, baseCfg)).toBeNull()
  })

  it('derives displayName from names when name claim absent', () => {
    const id = mapClaimsToIdentity(
      { sub: 's', email: 'e@e.com', given_name: 'Ann', family_name: 'Lee' },
      baseCfg
    )
    expect(id!.displayName).toBe('Ann Lee')
  })
})

describe('ssoClaims — resolveWorkspaceRole', () => {
  const cfg = { groupRoleMapping: { 'okta-guests': 'guest', 'okta-staff': 'member' }, defaultRole: 'member' }

  it('maps a known group to its role', () => {
    expect(resolveWorkspaceRole({ groups: ['okta-guests'] }, cfg)).toBe('guest')
  })

  it('falls back to defaultRole when no group matches', () => {
    expect(resolveWorkspaceRole({ groups: ['unknown'] }, cfg)).toBe('member')
  })

  it('NEVER escalates to an admin/elevated role even if group maps to it', () => {
    const evil = { groupRoleMapping: { everyone: 'admin' }, defaultRole: 'member' }
    expect(resolveWorkspaceRole({ groups: ['everyone'] }, evil)).toBe('member')
  })

  it('clamps an unsafe defaultRole to member', () => {
    const evil = { groupRoleMapping: {}, defaultRole: 'owner' }
    expect(resolveWorkspaceRole({ groups: [] }, evil)).toBe('member')
  })
})
