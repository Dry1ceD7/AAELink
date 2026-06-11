import type { Pool } from 'pg'

/**
 * IdP/SCIM group → role mapping store and applier.
 *
 * A mapping matches an IdP group (by name or id, exact or `*` wildcard) and
 * grants either a platform_role (aaelink.users.platform_role) or a workspace
 * role (aaelink.workspace_members.role). Highest priority wins per target kind.
 *
 * SECURITY CLAMP: a mapping can never grant `super_admin`. SSO/SCIM is an
 * external trust boundary; auto-granting the highest platform privilege from a
 * directory group would let anyone who can edit IdP group membership take over
 * the platform. `super_admin` targets are silently dropped at resolution time
 * (resolvePlatformRole) and rejected at write time (route validation).
 *
 * SEMANTICS LIMITATION (intentional, kept simple): grants are applied on SSO
 * login and on SCIM Groups membership change only. Removal from a group does
 * NOT auto-demote a user — there is no enforced/revocation pass. Re-grants are
 * idempotent (highest-priority match re-asserted each login/sync).
 */

export type TargetKind = 'platform_role' | 'workspace_role'

export interface IdpRoleMapping {
  id: string
  orgId: string | null
  workspaceId: string | null
  groupPattern: string
  targetKind: TargetKind
  targetRole: string
  priority: number
  isActive: boolean
}

interface MappingRow {
  id: string
  org_id: string | null
  workspace_id: string | null
  group_pattern: string
  target_kind: string
  target_role: string
  priority: number
  is_active: boolean
}

/** Platform roles a mapping is allowed to grant. super_admin is intentionally absent. */
const GRANTABLE_PLATFORM_ROLES = new Set(['it_admin', 'it_employee', 'employee'])
/** Workspace roles a mapping is allowed to grant. owner is reserved for explicit assignment. */
const GRANTABLE_WORKSPACE_ROLES = new Set(['admin', 'member', 'guest'])

/** True when the role is safe to grant via an IdP mapping for the given kind. */
export function isGrantableRole(kind: TargetKind, role: string): boolean {
  return kind === 'platform_role'
    ? GRANTABLE_PLATFORM_ROLES.has(role)
    : GRANTABLE_WORKSPACE_ROLES.has(role)
}

function rowToMapping(r: MappingRow): IdpRoleMapping {
  return {
    id: r.id,
    orgId: r.org_id,
    workspaceId: r.workspace_id,
    groupPattern: r.group_pattern,
    targetKind: r.target_kind as TargetKind,
    targetRole: r.target_role,
    priority: r.priority,
    isActive: r.is_active,
  }
}

/** Does an IdP group string match a mapping's pattern? `*` matches all; else exact (case-insensitive). */
function groupMatches(pattern: string, group: string): boolean {
  if (pattern === '*') return true
  return pattern.toLowerCase() === group.toLowerCase()
}

/**
 * Pure resolver: pick the highest-priority active mapping per target kind whose
 * pattern matches one of the user's groups. Returns the winning platform role
 * (clamped — never super_admin) and the winning workspace role + its workspace.
 */
export function resolveGrants(
  mappings: IdpRoleMapping[],
  groups: string[]
): { platformRole: string | null; workspaceRole: { workspaceId: string | null; role: string } | null } {
  let platform: IdpRoleMapping | null = null
  let workspace: IdpRoleMapping | null = null

  for (const m of mappings) {
    if (!m.isActive) continue
    if (!isGrantableRole(m.targetKind, m.targetRole)) continue // drops super_admin
    if (!groups.some(g => groupMatches(m.groupPattern, g))) continue
    if (m.targetKind === 'platform_role') {
      if (!platform || m.priority > platform.priority) platform = m
    } else {
      if (!workspace || m.priority > workspace.priority) workspace = m
    }
  }

  return {
    platformRole: platform ? platform.targetRole : null,
    workspaceRole: workspace
      ? { workspaceId: workspace.workspaceId, role: workspace.targetRole }
      : null,
  }
}

/** Load active mappings scoped to an org (null org_id mappings are global, always included). */
export async function loadActiveMappings(pool: Pool, orgId: string | null): Promise<IdpRoleMapping[]> {
  const { rows } = await pool.query<MappingRow>(
    `SELECT id, org_id::text AS org_id, workspace_id, group_pattern, target_kind,
            target_role, priority, is_active
       FROM aaelink.idp_group_role_mappings
      WHERE is_active = true AND (org_id IS NULL OR org_id = $1)
      ORDER BY priority DESC`,
    [orgId]
  )
  return rows.map(rowToMapping)
}

/**
 * Resolve the user's groups against active mappings and grant the winning roles.
 * Grant-only: never demotes. super_admin is clamped out by resolveGrants. The
 * platform role is only raised when the mapped role outranks the current one to
 * avoid downgrading an already-elevated account on a routine login/sync.
 */
export async function applyGroupRoleMappings(
  pool: Pool,
  userId: string,
  groups: string[],
  opts: { orgId?: string | null; defaultWorkspaceId?: string | null } = {}
): Promise<{ platformRoleGranted: string | null; workspaceRoleGranted: string | null }> {
  if (groups.length === 0) return { platformRoleGranted: null, workspaceRoleGranted: null }

  const mappings = await loadActiveMappings(pool, opts.orgId ?? null)
  const { platformRole, workspaceRole } = resolveGrants(mappings, groups)

  let platformRoleGranted: string | null = null
  if (platformRole) {
    // Grant-only: never downgrade an existing higher platform role. super_admin
    // is already excluded from platformRole by the clamp in resolveGrants.
    const RANK: Record<string, number> = { '': 0, employee: 1, it_employee: 2, it_admin: 3, super_admin: 4 }
    const { rows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`,
      [userId]
    )
    const current = rows[0]?.platform_role ?? ''
    if ((RANK[platformRole] ?? 0) > (RANK[current] ?? 0)) {
      await pool.query(`UPDATE aaelink.users SET platform_role = $1 WHERE id = $2`, [platformRole, userId])
      platformRoleGranted = platformRole
    }
  }

  let workspaceRoleGranted: string | null = null
  if (workspaceRole) {
    const wsId = workspaceRole.workspaceId ?? opts.defaultWorkspaceId ?? null
    if (wsId) {
      await pool.query(
        `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [wsId, userId, workspaceRole.role]
      )
      workspaceRoleGranted = workspaceRole.role
    }
  }

  return { platformRoleGranted, workspaceRoleGranted }
}
