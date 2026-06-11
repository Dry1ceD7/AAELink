/**
 * AAELink — IdP/SCIM group → role mapping resolver tests (pure, no DB).
 *
 * Covers: priority resolution per target kind, wildcard + case-insensitive
 * group matching, the super_admin clamp (never grantable), and the
 * isGrantableRole allow-lists.
 */
import { describe, it, expect } from 'vitest'
import { resolveGrants, isGrantableRole, type IdpRoleMapping } from '@/lib/auth/idpRoleMappings'

function mapping(p: Partial<IdpRoleMapping> & Pick<IdpRoleMapping, 'groupPattern' | 'targetKind' | 'targetRole'>): IdpRoleMapping {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    orgId: p.orgId ?? null,
    workspaceId: p.workspaceId ?? null,
    groupPattern: p.groupPattern,
    targetKind: p.targetKind,
    targetRole: p.targetRole,
    priority: p.priority ?? 0,
    isActive: p.isActive ?? true,
  }
}

describe('isGrantableRole — clamp allow-lists', () => {
  it('never allows super_admin as a platform_role grant', () => {
    expect(isGrantableRole('platform_role', 'super_admin')).toBe(false)
  })
  it('allows it_admin / it_employee / employee platform roles', () => {
    expect(isGrantableRole('platform_role', 'it_admin')).toBe(true)
    expect(isGrantableRole('platform_role', 'it_employee')).toBe(true)
    expect(isGrantableRole('platform_role', 'employee')).toBe(true)
  })
  it('allows admin / member / guest workspace roles, rejects owner', () => {
    expect(isGrantableRole('workspace_role', 'admin')).toBe(true)
    expect(isGrantableRole('workspace_role', 'member')).toBe(true)
    expect(isGrantableRole('workspace_role', 'guest')).toBe(true)
    expect(isGrantableRole('workspace_role', 'owner')).toBe(false)
    expect(isGrantableRole('workspace_role', 'super_admin')).toBe(false)
  })
})

describe('resolveGrants — clamp', () => {
  it('drops a super_admin mapping even when its group matches', () => {
    const m = [mapping({ groupPattern: 'admins', targetKind: 'platform_role', targetRole: 'super_admin', priority: 100 })]
    const res = resolveGrants(m, ['admins'])
    expect(res.platformRole).toBeNull()
  })
})

describe('resolveGrants — priority resolution', () => {
  it('highest-priority matching platform mapping wins', () => {
    const m = [
      mapping({ groupPattern: 'staff', targetKind: 'platform_role', targetRole: 'employee', priority: 1 }),
      mapping({ groupPattern: 'it', targetKind: 'platform_role', targetRole: 'it_admin', priority: 10 }),
    ]
    const res = resolveGrants(m, ['staff', 'it'])
    expect(res.platformRole).toBe('it_admin')
  })

  it('resolves platform and workspace kinds independently', () => {
    const m = [
      mapping({ groupPattern: 'it', targetKind: 'platform_role', targetRole: 'it_admin', priority: 5 }),
      mapping({ groupPattern: 'wsteam', targetKind: 'workspace_role', targetRole: 'admin', priority: 5, workspaceId: 'ws-1' }),
    ]
    const res = resolveGrants(m, ['it', 'wsteam'])
    expect(res.platformRole).toBe('it_admin')
    expect(res.workspaceRole).toEqual({ workspaceId: 'ws-1', role: 'admin' })
  })

  it('ignores inactive mappings', () => {
    const m = [mapping({ groupPattern: 'it', targetKind: 'platform_role', targetRole: 'it_admin', priority: 9, isActive: false })]
    expect(resolveGrants(m, ['it']).platformRole).toBeNull()
  })

  it('returns null when no group matches', () => {
    const m = [mapping({ groupPattern: 'it', targetKind: 'platform_role', targetRole: 'it_admin' })]
    expect(resolveGrants(m, ['sales']).platformRole).toBeNull()
  })
})

describe('resolveGrants — group matching', () => {
  it('matches case-insensitively', () => {
    const m = [mapping({ groupPattern: 'IT-Admins', targetKind: 'platform_role', targetRole: 'it_admin' })]
    expect(resolveGrants(m, ['it-admins']).platformRole).toBe('it_admin')
  })
  it('wildcard pattern matches any group', () => {
    const m = [mapping({ groupPattern: '*', targetKind: 'platform_role', targetRole: 'employee' })]
    expect(resolveGrants(m, ['anything']).platformRole).toBe('employee')
  })
})
