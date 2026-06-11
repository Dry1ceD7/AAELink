/**
 * D1 Enterprise Grid — enterprise identity translation layer.
 *
 * AAELink already uses one global `users.id` referenced by every workspace and
 * channel, so a person has a single identity. What was missing is the bridge
 * between the two membership graphs the rest of the code keeps deliberately
 * separate:
 *
 *   - workspace_members — the OPERATIONAL graph. Discovery, channels, and the
 *     workspace lifecycle run on this; a person's per-workspace memberships are
 *     their "local identities".
 *   - org_members — the ENTERPRISE graph. Org-level roles (org_owner/org_admin)
 *     and admin governance run on this id space.
 *
 * These drift: joining a workspace in an org does not make you an org member.
 * This module is the translation layer that reconciles them — a person with
 * standing in any workspace of an org IS that org's enterprise identity. It
 * resolves a user's org-level identity from their operational footprint, lists
 * the true enterprise member set, and backfills org_members so the enterprise
 * graph stays consistent with operational membership. Legacy workspace-scoped
 * ids are translated separately in lib/enterprise/userIdMigration.ts.
 */
import type { Pool } from 'pg'
import type { OrgRole } from './orgMembers'

export interface LocalIdentity {
  workspace_id: string
  role: string
}

export interface EnterpriseIdentity {
  org_id: string
  user_id: string
  /** Explicit org_members role, or null when membership is only derived from workspace standing. */
  org_role: OrgRole | null
  /** True when the user has any org standing (an org_members row or ≥1 workspace in the org). */
  is_member: boolean
  /** Per-workspace memberships in this org — the user's local identities. */
  workspaces: LocalIdentity[]
}

/**
 * Resolve a user's enterprise identity within an org: their explicit org role
 * (if any) and every workspace membership they hold in the org. Returns null
 * when the user has no standing at all (no org_members row and no workspace in
 * the org) — i.e. they are not part of the org.
 */
export async function getEnterpriseIdentity(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<EnterpriseIdentity | null> {
  const { rows: roleRows } = await pool.query<{ role: OrgRole }>(
    `SELECT role FROM aaelink.org_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId]
  )
  const orgRole = roleRows[0]?.role ?? null

  const { rows: wsRows } = await pool.query<LocalIdentity>(
    `SELECT wm.workspace_id, wm.role
       FROM aaelink.workspace_members wm
       JOIN aaelink.workspaces w ON w.id = wm.workspace_id
      WHERE w.org_id = $1 AND wm.user_id = $2
      ORDER BY wm.workspace_id ASC`,
    [orgId, userId]
  )

  if (!orgRole && wsRows.length === 0) return null

  return {
    org_id: orgId,
    user_id: userId,
    org_role: orgRole,
    is_member: true,
    workspaces: wsRows,
  }
}

export interface EnterpriseMember {
  user_id: string
  username: string
  email: string
  /** Explicit org_members role, or null when membership is only derived from workspace standing. */
  org_role: OrgRole | null
  /** Number of workspaces in this org the user belongs to. */
  workspace_count: number
}

/**
 * List the true enterprise member set for an org: every user with standing via
 * an explicit org_members row OR membership in any workspace of the org. This is
 * the canonical "who is in the org" answer, distinct from the manually-managed
 * org_members list alone.
 */
export async function listEnterpriseMembers(
  pool: Pool,
  orgId: string,
  limit = 100,
  offset = 0
): Promise<EnterpriseMember[]> {
  const { rows } = await pool.query<EnterpriseMember>(
    `WITH ids AS (
       SELECT user_id FROM aaelink.org_members WHERE org_id = $1
       UNION
       SELECT wm.user_id
         FROM aaelink.workspace_members wm
         JOIN aaelink.workspaces w ON w.id = wm.workspace_id
        WHERE w.org_id = $1
     )
     SELECT u.id AS user_id, u.username, u.email,
            om.role AS org_role,
            (SELECT count(*)::int
               FROM aaelink.workspace_members wm2
               JOIN aaelink.workspaces w2 ON w2.id = wm2.workspace_id
              WHERE w2.org_id = $1 AND wm2.user_id = u.id) AS workspace_count
       FROM ids
       JOIN aaelink.users u ON u.id = ids.user_id
       LEFT JOIN aaelink.org_members om ON om.org_id = $1 AND om.user_id = u.id
      ORDER BY u.username ASC
      LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  )
  return rows
}

/**
 * Backfill org_members from operational workspace membership: every user with a
 * workspace in the org but no org_members row is added with role 'member'.
 * Existing rows (and their roles) are left untouched. Idempotent. Returns the
 * number of enterprise-identity rows created.
 */
export async function reconcileOrgMembership(pool: Pool, orgId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `INSERT INTO aaelink.org_members (org_id, user_id, role)
     SELECT DISTINCT $1::uuid, wm.user_id, 'member'
       FROM aaelink.workspace_members wm
       JOIN aaelink.workspaces w ON w.id = wm.workspace_id
      WHERE w.org_id = $1::uuid
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [orgId]
  )
  return rowCount ?? 0
}
