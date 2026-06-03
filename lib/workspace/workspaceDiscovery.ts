/**
 * D1 Enterprise Grid — workspace discovery within an organization.
 *
 * "Org" scope is derived from shared `workspaces.org_id`: a user may
 * discover and join any `open` workspace that belongs to the same org as
 * a workspace they already belong to, and that they are not already in.
 * This deliberately keeps discovery on the workspace-membership graph and
 * does not depend on the separate `org_members` table (which uses a
 * distinct enterprise-identity id space).
 *
 * Access levels (migration 002):
 *   - open         — discoverable + self-join
 *   - invite_only  — needs an invite (default; never discoverable here)
 *   - managed      — admin-provisioned only (never self-join)
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export interface DiscoverableWorkspace {
  id: string
  name: string
  display_name: string
  access_level: string
  member_count: number
}

export type JoinResult =
  | { ok: true; workspaceId: string; channelId: string | null }
  | { ok: false; code: 'not_found' | 'not_open' | 'already_member' | 'not_in_org' }

/**
 * List `open` workspaces in the same org(s) as the user that the user has
 * not already joined. Returns [] when the user belongs to no org-linked
 * workspace.
 */
export async function listDiscoverableWorkspaces(
  pool: Pool,
  uid: string
): Promise<DiscoverableWorkspace[]> {
  const { rows } = await pool.query<DiscoverableWorkspace>(
    `SELECT w.id, w.name, w.display_name, w.access_level,
            (SELECT count(*)::int FROM aaelink.workspace_members wm
              WHERE wm.workspace_id = w.id) AS member_count
       FROM aaelink.workspaces w
      WHERE w.access_level = 'open'
        AND w.org_id IS NOT NULL
        AND w.org_id IN (
          SELECT DISTINCT w2.org_id
            FROM aaelink.workspaces w2
            JOIN aaelink.workspace_members m2
              ON m2.workspace_id = w2.id AND m2.user_id = $1
           WHERE w2.org_id IS NOT NULL
        )
        AND w.id NOT IN (
          SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1
        )
      ORDER BY w.display_name ASC`,
    [uid]
  )
  return rows
}

/**
 * Join an `open` workspace in the user's org. Validates the workspace is
 * open, shares an org with the user, and that the user is not already a
 * member. On success adds the membership and auto-joins the default
 * channel (Slack parity), inside a transaction.
 */
export async function joinOpenWorkspace(
  pool: Pool,
  uid: string,
  workspaceId: string
): Promise<JoinResult> {
  const { rows } = await pool.query<{ access_level: string; org_id: string | null }>(
    `SELECT access_level, org_id FROM aaelink.workspaces WHERE id = $1`,
    [workspaceId]
  )
  const ws = rows[0]
  if (!ws) return { ok: false, code: 'not_found' }
  if (ws.access_level !== 'open') return { ok: false, code: 'not_open' }
  if (!ws.org_id) return { ok: false, code: 'not_in_org' }

  const { rows: existing } = await pool.query(
    `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  if (existing.length > 0) return { ok: false, code: 'already_member' }

  // Caller must share the target workspace's org via their own membership.
  const { rows: sameOrg } = await pool.query(
    `SELECT 1
       FROM aaelink.workspaces w2
       JOIN aaelink.workspace_members m2
         ON m2.workspace_id = w2.id AND m2.user_id = $1
      WHERE w2.org_id = $2
      LIMIT 1`,
    [uid, ws.org_id]
  )
  if (sameOrg.length === 0) return { ok: false, code: 'not_in_org' }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const now = Date.now()
    await client.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [workspaceId, uid]
    )
    const { rows: def } = await client.query<{ id: string }>(
      `SELECT id FROM aaelink.channels
        WHERE workspace_id = $1 AND is_default = TRUE
        ORDER BY created_at ASC LIMIT 1`,
      [workspaceId]
    )
    const channelId = def[0]?.id ?? null
    if (channelId) {
      await client.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3)
         ON CONFLICT DO NOTHING`,
        [channelId, uid, now]
      )
    }
    await client.query('COMMIT')
    return { ok: true, workspaceId, channelId }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
