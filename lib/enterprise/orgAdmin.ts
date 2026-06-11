import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { log } from '@/lib/infra/log'

/**
 * Organization (Enterprise Grid) administration.
 *
 * Provides CRUD for the top-level `organizations` entity and
 * helpers to bind / unbind workspaces to an org.
 */

export type OrgPlan = 'free' | 'pro' | 'business_plus' | 'enterprise_grid'

export interface Organization {
  id:         string
  name:       string
  domain:     string
  plan:       OrgPlan
  settings:   Record<string, unknown>
  created_at: string
  updated_at: string
}

// ── CRUD ────────────────────────────────────────────────────────────

export async function createOrganization(
  name: string,
  domain: string,
  plan: OrgPlan = 'free'
): Promise<Organization | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<Organization>(
    `INSERT INTO aaelink.organizations (name, domain, plan)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, domain, plan]
  )
  return rows[0] ?? null
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<Organization>(
    `SELECT * FROM aaelink.organizations WHERE id = $1`,
    [orgId]
  )
  return rows[0] ?? null
}

export async function updateOrganization(
  orgId: string,
  updates: Partial<Pick<Organization, 'name' | 'domain' | 'plan' | 'settings'>>
): Promise<Organization | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null

  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1

  if (updates.name !== undefined)     { sets.push(`name = $${idx++}`);     vals.push(updates.name) }
  if (updates.domain !== undefined)   { sets.push(`domain = $${idx++}`);   vals.push(updates.domain) }
  if (updates.plan !== undefined)     { sets.push(`plan = $${idx++}`);     vals.push(updates.plan) }
  if (updates.settings !== undefined) { sets.push(`settings = $${idx++}`); vals.push(JSON.stringify(updates.settings)) }

  if (sets.length === 0) return getOrganization(orgId)

  sets.push(`updated_at = now()`)
  vals.push(orgId)

  const { rows } = await pool.query<Organization>(
    `UPDATE aaelink.organizations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  )
  return rows[0] ?? null
}

export async function deleteOrganization(orgId: string): Promise<boolean> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return false
  const res = await pool.query(
    `DELETE FROM aaelink.organizations WHERE id = $1`,
    [orgId]
  )
  return (res.rowCount ?? 0) > 0
}

// ── Workspace binding ───────────────────────────────────────────────

export async function listOrgWorkspaces(orgId: string) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query(
    `SELECT * FROM aaelink.workspaces WHERE org_id = $1 ORDER BY name`,
    [orgId]
  )
  return rows
}

export async function addWorkspaceToOrg(orgId: string, workspaceId: string): Promise<boolean> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return false
  const res = await pool.query(
    `UPDATE aaelink.workspaces SET org_id = $1 WHERE id = $2`,
    [orgId, workspaceId]
  )
  return (res.rowCount ?? 0) > 0
}

export async function removeWorkspaceFromOrg(workspaceId: string): Promise<boolean> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return false
  const res = await pool.query(
    `UPDATE aaelink.workspaces SET org_id = NULL WHERE id = $1`,
    [workspaceId]
  )
  return (res.rowCount ?? 0) > 0
}

export async function listOrganizations() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<Organization>(
    `SELECT * FROM aaelink.organizations ORDER BY name`
  )
  return rows
}
