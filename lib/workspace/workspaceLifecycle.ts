/**
 * D1 Enterprise Grid — workspace archive + move lifecycle.
 *
 * Completes the workspace lifecycle alongside create (POST /api/workspaces),
 * discovery, and access levels (lib/workspace/workspaceDiscovery.ts):
 *
 *   - archive / unarchive: an owner takes a workspace out of active use
 *     (archived_at = now) and restores it (archived_at = 0). Archived
 *     workspaces are excluded from discovery and flagged in the switcher.
 *   - move: an owner reassigns a workspace's organization (org_id), or detaches
 *     it (org_id = null). Moving INTO an org requires the caller to already have
 *     standing in that org (membership of a sibling workspace) — mirroring
 *     joinOpenWorkspace, this keeps lifecycle on the workspace-membership graph
 *     rather than the separate org_members enterprise-identity id space.
 *
 * The system workspace (is_system) can be neither archived nor moved — the same
 * guard the delete path uses. Non-members get not_found (no existence leak);
 * non-owner members get forbidden.
 */
import type { Pool } from 'pg'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WorkspaceLifecycleRow {
  is_system: boolean
  role: string
  archived_at: string
}

/** Load the caller's role + workspace flags, or null when not a member. */
async function loadWorkspaceForActor(
  pool: Pool,
  uid: string,
  workspaceId: string
): Promise<WorkspaceLifecycleRow | null> {
  const { rows } = await pool.query<WorkspaceLifecycleRow>(
    `SELECT w.is_system, m.role, w.archived_at::text
       FROM aaelink.workspaces w
       JOIN aaelink.workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
      WHERE w.id = $2`,
    [uid, workspaceId]
  )
  return rows[0] ?? null
}

// ── Archive ──────────────────────────────────────────────────────────

export type ArchiveResult =
  | { ok: true; workspaceId: string; archivedAt: number }
  | { ok: false; code: 'not_found' | 'forbidden' | 'system_workspace' | 'already_archived' }

/** Archive a workspace. Owner-only; the system workspace cannot be archived. */
export async function archiveWorkspace(
  pool: Pool,
  uid: string,
  workspaceId: string
): Promise<ArchiveResult> {
  const row = await loadWorkspaceForActor(pool, uid, workspaceId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.is_system) return { ok: false, code: 'system_workspace' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }
  if (Number(row.archived_at) > 0) return { ok: false, code: 'already_archived' }

  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.workspaces SET archived_at = $1, archived_by = $2 WHERE id = $3`,
    [now, uid, workspaceId]
  )
  return { ok: true, workspaceId, archivedAt: now }
}

// ── Unarchive ────────────────────────────────────────────────────────

export type UnarchiveResult =
  | { ok: true; workspaceId: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_archived' }

/** Restore an archived workspace. Owner-only. */
export async function unarchiveWorkspace(
  pool: Pool,
  uid: string,
  workspaceId: string
): Promise<UnarchiveResult> {
  const row = await loadWorkspaceForActor(pool, uid, workspaceId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }
  if (Number(row.archived_at) === 0) return { ok: false, code: 'not_archived' }

  await pool.query(
    `UPDATE aaelink.workspaces SET archived_at = 0, archived_by = NULL WHERE id = $1`,
    [workspaceId]
  )
  return { ok: true, workspaceId }
}

// ── Move between organizations ───────────────────────────────────────

export type MoveResult =
  | { ok: true; workspaceId: string; orgId: string | null }
  | { ok: false; code: 'not_found' | 'forbidden' | 'system_workspace' | 'org_not_found' | 'not_in_org' }

/**
 * Reassign a workspace's organization. `targetOrgId = null` detaches it.
 * Owner-only; the system workspace cannot be moved. Moving into an org requires
 * the caller to already belong to a sibling workspace in that org.
 */
export async function moveWorkspaceToOrg(
  pool: Pool,
  uid: string,
  workspaceId: string,
  targetOrgId: string | null
): Promise<MoveResult> {
  const row = await loadWorkspaceForActor(pool, uid, workspaceId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.is_system) return { ok: false, code: 'system_workspace' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }

  if (targetOrgId !== null) {
    // Guard the UUID format before querying — org_id is a uuid column and a
    // malformed value would raise a Postgres cast error instead of a clean code.
    if (!UUID_RE.test(targetOrgId)) return { ok: false, code: 'org_not_found' }
    const { rows: org } = await pool.query(
      `SELECT 1 FROM aaelink.organizations WHERE id = $1`,
      [targetOrgId]
    )
    if (org.length === 0) return { ok: false, code: 'org_not_found' }

    const { rows: standing } = await pool.query(
      `SELECT 1
         FROM aaelink.workspaces w2
         JOIN aaelink.workspace_members m2
           ON m2.workspace_id = w2.id AND m2.user_id = $1
        WHERE w2.org_id = $2
        LIMIT 1`,
      [uid, targetOrgId]
    )
    if (standing.length === 0) return { ok: false, code: 'not_in_org' }
  }

  await pool.query(
    `UPDATE aaelink.workspaces SET org_id = $1 WHERE id = $2`,
    [targetOrgId, workspaceId]
  )
  return { ok: true, workspaceId, orgId: targetOrgId }
}
