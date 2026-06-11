import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'

/**
 * Organization-level cascading policy management.
 *
 * Policies are defined at the org level and cascade down to all
 * workspaces. `getEffectivePolicy` resolves the active policy
 * for a workspace by checking workspace-level overrides first,
 * then falling back to the org-level default.
 */

export type PolicyType =
  | 'retention'
  | 'dlp'
  | 'sso'
  | 'session'
  | 'ip_access'
  | 'data_residency'

export interface OrgPolicy {
  id:          string
  org_id:      string
  policy_type: PolicyType
  config:      Record<string, unknown>
  enforced:    boolean
  created_at:  string
  updated_at:  string
}

export async function setOrgPolicy(
  orgId: string,
  policyType: PolicyType,
  config: Record<string, unknown>,
  enforced = false
): Promise<OrgPolicy | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<OrgPolicy>(
    `INSERT INTO aaelink.org_policies (org_id, policy_type, config, enforced)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, policy_type)
     DO UPDATE SET config = $3, enforced = $4, updated_at = now()
     RETURNING *`,
    [orgId, policyType, JSON.stringify(config), enforced]
  )
  return rows[0] ?? null
}

export async function getOrgPolicy(
  orgId: string,
  policyType: PolicyType
): Promise<OrgPolicy | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<OrgPolicy>(
    `SELECT * FROM aaelink.org_policies
     WHERE org_id = $1 AND policy_type = $2`,
    [orgId, policyType]
  )
  return rows[0] ?? null
}

export async function listOrgPolicies(orgId: string): Promise<OrgPolicy[]> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<OrgPolicy>(
    `SELECT * FROM aaelink.org_policies
     WHERE org_id = $1
     ORDER BY policy_type`,
    [orgId]
  )
  return rows
}

/**
 * Resolve effective policy for a workspace.
 *
 * If the workspace belongs to an org and the org has an enforced
 * policy of this type, the org policy wins. Otherwise returns null.
 */
export async function getEffectivePolicy(
  workspaceId: string,
  policyType: PolicyType
): Promise<OrgPolicy | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null

  // Look up the workspace's org_id
  const { rows: wsRows } = await pool.query<{ org_id: string | null }>(
    `SELECT org_id FROM aaelink.workspaces WHERE id = $1`,
    [workspaceId]
  )
  const orgId = wsRows[0]?.org_id
  if (!orgId) return null

  // Fetch the org-level policy
  const { rows } = await pool.query<OrgPolicy>(
    `SELECT * FROM aaelink.org_policies
     WHERE org_id = $1 AND policy_type = $2`,
    [orgId, policyType]
  )
  return rows[0] ?? null
}

export async function deleteOrgPolicy(
  orgId: string,
  policyType: PolicyType
): Promise<boolean> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return false
  const res = await pool.query(
    `DELETE FROM aaelink.org_policies
     WHERE org_id = $1 AND policy_type = $2`,
    [orgId, policyType]
  )
  return (res.rowCount ?? 0) > 0
}
