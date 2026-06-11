import type { Pool } from 'pg'

/**
 * Legacy → Enterprise Grid user ID exchange.
 *
 * Maps old workspace-scoped user IDs to org-level IDs
 * during Enterprise Grid migration.
 */

export interface IdMapping {
  old_id: string
  new_id: string
  org_id: string
  mapped_at: number
}

export async function exchangeUserIds(
  pool: Pool, legacyIds: string[], targetOrgId: string
): Promise<Record<string, string>> {
  if (legacyIds.length === 0) return {}

  const placeholders = legacyIds.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await pool.query<{ old_id: string; new_id: string }>(
    `SELECT old_id, new_id FROM aaelink.user_id_mappings
     WHERE old_id IN (${placeholders}) AND org_id = $${legacyIds.length + 1}`,
    [...legacyIds, targetOrgId]
  )
  const result: Record<string, string> = {}
  for (const row of rows) result[row.old_id] = row.new_id
  return result
}

export async function registerLegacyMapping(
  pool: Pool, oldId: string, newId: string, orgId: string
): Promise<void> {
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.user_id_mappings (old_id, new_id, org_id, mapped_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (old_id, org_id) DO UPDATE SET new_id = $2, mapped_at = $4`,
    [oldId, newId, orgId, now]
  )
}

export async function lookupLegacyId(
  pool: Pool, oldId: string
): Promise<string | null> {
  const { rows } = await pool.query<{ new_id: string }>(
    `SELECT new_id FROM aaelink.user_id_mappings WHERE old_id = $1 LIMIT 1`,
    [oldId]
  )
  return rows[0]?.new_id ?? null
}
