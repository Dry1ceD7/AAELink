/**
 * D1 Enterprise Grid — multi-workspace shared channels.
 *
 * A channel keeps its home `workspace_id`, but it can be shared into a selected
 * SUBSET of sibling workspaces in the same org (Slack Grid multi-workspace
 * channels). Each `channel_workspaces` row adds one more workspace the channel
 * appears in and is joinable from. This differs from org-wide channels
 * (lib/channels/orgWideChannels.ts), where a channel is exposed to every
 * workspace in the org at once.
 *
 * Authorization mirrors org-wide sharing: the owner of the channel's home
 * workspace shares/unshares it, only public ('O') channels qualify, and the
 * target workspace must belong to the same org as the home workspace. Discovery
 * and join run on the workspace-membership graph — a user may join a shared
 * channel when they belong to a workspace it has been shared into. Non-members
 * of the home workspace get not_found (no existence leak).
 */
import type { Pool } from 'pg'

interface ChannelOwnerRow {
  workspace_id: string
  type: string
  org_id: string | null
  role: string
}

/** Load the channel + the caller's role in its home workspace, or null. */
async function loadChannelForActor(
  pool: Pool,
  uid: string,
  channelId: string
): Promise<ChannelOwnerRow | null> {
  const { rows } = await pool.query<ChannelOwnerRow>(
    `SELECT c.workspace_id, c.type, w.org_id::text AS org_id, m.role
       FROM aaelink.channels c
       JOIN aaelink.workspaces w ON w.id = c.workspace_id
       JOIN aaelink.workspace_members m ON m.workspace_id = c.workspace_id AND m.user_id = $1
      WHERE c.id = $2`,
    [uid, channelId]
  )
  return rows[0] ?? null
}

// ── Share / unshare ──────────────────────────────────────────────────

export type ShareToWorkspaceResult =
  | { ok: true; channelId: string; workspaceId: string }
  | {
      ok: false
      code:
        | 'not_found'
        | 'forbidden'
        | 'not_public'
        | 'no_org'
        | 'target_not_found'
        | 'cross_org'
        | 'same_workspace'
        | 'already_shared'
    }

/**
 * Share a public channel into one sibling workspace. Home-workspace owner only.
 * The target workspace must belong to the same org and not be the home
 * workspace itself.
 */
export async function shareChannelToWorkspace(
  pool: Pool,
  uid: string,
  channelId: string,
  targetWorkspaceId: string
): Promise<ShareToWorkspaceResult> {
  const row = await loadChannelForActor(pool, uid, channelId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }
  if (row.type !== 'O') return { ok: false, code: 'not_public' }
  if (!row.org_id) return { ok: false, code: 'no_org' }
  if (targetWorkspaceId === row.workspace_id) return { ok: false, code: 'same_workspace' }

  const { rows: wsRows } = await pool.query<{ org_id: string | null }>(
    `SELECT org_id::text FROM aaelink.workspaces WHERE id = $1`,
    [targetWorkspaceId]
  )
  const targetWs = wsRows[0]
  if (!targetWs) return { ok: false, code: 'target_not_found' }
  if (targetWs.org_id !== row.org_id) return { ok: false, code: 'cross_org' }

  const { rows: existing } = await pool.query(
    `SELECT 1 FROM aaelink.channel_workspaces WHERE channel_id = $1 AND workspace_id = $2`,
    [channelId, targetWorkspaceId]
  )
  if (existing.length > 0) return { ok: false, code: 'already_shared' }

  await pool.query(
    `INSERT INTO aaelink.channel_workspaces (channel_id, workspace_id, added_by, added_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [channelId, targetWorkspaceId, uid, Date.now()]
  )
  return { ok: true, channelId, workspaceId: targetWorkspaceId }
}

export type UnshareFromWorkspaceResult =
  | { ok: true; channelId: string; workspaceId: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_shared' }

/** Remove a channel's share into one workspace. Home-workspace owner only. */
export async function unshareChannelFromWorkspace(
  pool: Pool,
  uid: string,
  channelId: string,
  targetWorkspaceId: string
): Promise<UnshareFromWorkspaceResult> {
  const row = await loadChannelForActor(pool, uid, channelId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }

  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.channel_workspaces WHERE channel_id = $1 AND workspace_id = $2`,
    [channelId, targetWorkspaceId]
  )
  if (!rowCount) return { ok: false, code: 'not_shared' }
  return { ok: true, channelId, workspaceId: targetWorkspaceId }
}

// ── Discover / join ──────────────────────────────────────────────────

export interface DiscoverableSharedChannel {
  id: string
  name: string
  display_name: string
  workspace_id: string
  member_count: number
}

/**
 * List channels shared into a workspace the user belongs to, excluding channels
 * whose home workspace the user is already in (they see those natively) and
 * channels the user has already joined. Archived channels are excluded.
 */
export async function listSharedWorkspaceChannels(
  pool: Pool,
  uid: string
): Promise<DiscoverableSharedChannel[]> {
  const { rows } = await pool.query<DiscoverableSharedChannel>(
    `SELECT DISTINCT c.id, c.name, c.display_name, c.workspace_id,
            (SELECT count(*)::int FROM aaelink.channel_members cm
              WHERE cm.channel_id = c.id) AS member_count
       FROM aaelink.channel_workspaces cw
       JOIN aaelink.channels c ON c.id = cw.channel_id
       JOIN aaelink.workspace_members m
         ON m.workspace_id = cw.workspace_id AND m.user_id = $1
      WHERE c.archived_at = 0
        AND c.workspace_id NOT IN (
          SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1
        )
        AND c.id NOT IN (
          SELECT channel_id FROM aaelink.channel_members WHERE user_id = $1
        )
      ORDER BY c.display_name ASC`,
    [uid]
  )
  return rows
}

export type JoinSharedChannelResult =
  | { ok: true; channelId: string }
  | { ok: false; code: 'not_found' | 'not_shared_to_user' | 'already_member' }

/**
 * Join a multi-workspace shared channel. Validates the channel is active and has
 * been shared into a workspace the user belongs to, and that the user is not
 * already a member.
 */
export async function joinSharedWorkspaceChannel(
  pool: Pool,
  uid: string,
  channelId: string
): Promise<JoinSharedChannelResult> {
  const { rows } = await pool.query<{ archived_at: string }>(
    `SELECT archived_at::text FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  const ch = rows[0]
  if (!ch || Number(ch.archived_at) > 0) return { ok: false, code: 'not_found' }

  const { rows: shared } = await pool.query(
    `SELECT 1
       FROM aaelink.channel_workspaces cw
       JOIN aaelink.workspace_members m
         ON m.workspace_id = cw.workspace_id AND m.user_id = $1
      WHERE cw.channel_id = $2
      LIMIT 1`,
    [uid, channelId]
  )
  if (shared.length === 0) return { ok: false, code: 'not_shared_to_user' }

  const { rows: existing } = await pool.query(
    `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  if (existing.length > 0) return { ok: false, code: 'already_member' }

  await pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3)
     ON CONFLICT DO NOTHING`,
    [channelId, uid, Date.now()]
  )
  return { ok: true, channelId }
}
