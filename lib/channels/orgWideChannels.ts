/**
 * D1 Enterprise Grid — org-wide channels.
 *
 * A channel keeps its home `workspace_id`, but when promoted to org-wide it
 * gains `org_id` + `is_org_wide = true` and becomes discoverable and joinable by
 * any member of any workspace in that org (Slack Grid org-wide channels).
 *
 * Authorization mirrors the workspace lifecycle: the owner of the channel's
 * home workspace promotes/demotes it, and discovery/join run on the
 * workspace-membership graph (a user shares a channel's org when they belong to
 * a sibling workspace in it) rather than the separate org_members id space.
 * Only public ('O') channels can be org-wide; the home workspace must belong to
 * an org. Non-members of the home workspace get not_found (no existence leak).
 */
import type { Pool } from 'pg'

interface ChannelOwnerRow {
  workspace_id: string
  type: string
  is_org_wide: boolean
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
    `SELECT c.workspace_id, c.type, c.is_org_wide, w.org_id::text AS org_id, m.role
       FROM aaelink.channels c
       JOIN aaelink.workspaces w ON w.id = c.workspace_id
       JOIN aaelink.workspace_members m ON m.workspace_id = c.workspace_id AND m.user_id = $1
      WHERE c.id = $2`,
    [uid, channelId]
  )
  return rows[0] ?? null
}

// ── Promote / demote ─────────────────────────────────────────────────

export type PromoteOrgWideResult =
  | { ok: true; channelId: string; orgId: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_public' | 'no_org' | 'already_org_wide' }

/** Promote a public channel to org-wide. Home-workspace owner only. */
export async function promoteChannelToOrgWide(
  pool: Pool,
  uid: string,
  channelId: string
): Promise<PromoteOrgWideResult> {
  const row = await loadChannelForActor(pool, uid, channelId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }
  if (row.type !== 'O') return { ok: false, code: 'not_public' }
  if (!row.org_id) return { ok: false, code: 'no_org' }
  if (row.is_org_wide) return { ok: false, code: 'already_org_wide' }

  await pool.query(
    `UPDATE aaelink.channels SET org_id = $1, is_org_wide = true WHERE id = $2`,
    [row.org_id, channelId]
  )
  return { ok: true, channelId, orgId: row.org_id }
}

export type DemoteOrgWideResult =
  | { ok: true; channelId: string }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_org_wide' }

/** Demote an org-wide channel back to workspace scope. Home-workspace owner only. */
export async function demoteOrgWideChannel(
  pool: Pool,
  uid: string,
  channelId: string
): Promise<DemoteOrgWideResult> {
  const row = await loadChannelForActor(pool, uid, channelId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.role !== 'owner') return { ok: false, code: 'forbidden' }
  if (!row.is_org_wide) return { ok: false, code: 'not_org_wide' }

  await pool.query(
    `UPDATE aaelink.channels SET org_id = NULL, is_org_wide = false WHERE id = $1`,
    [channelId]
  )
  return { ok: true, channelId }
}

// ── Discover / join ──────────────────────────────────────────────────

export interface DiscoverableOrgWideChannel {
  id: string
  name: string
  display_name: string
  org_id: string
  workspace_id: string
  member_count: number
}

/**
 * List org-wide channels in the user's org(s) that the user has not joined.
 * Excludes archived channels. Returns [] when the user belongs to no
 * org-linked workspace.
 */
export async function listOrgWideChannels(
  pool: Pool,
  uid: string
): Promise<DiscoverableOrgWideChannel[]> {
  const { rows } = await pool.query<DiscoverableOrgWideChannel>(
    `SELECT c.id, c.name, c.display_name, c.org_id::text AS org_id, c.workspace_id,
            (SELECT count(*)::int FROM aaelink.channel_members cm
              WHERE cm.channel_id = c.id) AS member_count
       FROM aaelink.channels c
      WHERE c.is_org_wide = true
        AND c.archived_at = 0
        AND c.org_id IS NOT NULL
        AND c.org_id IN (
          SELECT DISTINCT w2.org_id
            FROM aaelink.workspaces w2
            JOIN aaelink.workspace_members m2
              ON m2.workspace_id = w2.id AND m2.user_id = $1
           WHERE w2.org_id IS NOT NULL
        )
        AND c.id NOT IN (
          SELECT channel_id FROM aaelink.channel_members WHERE user_id = $1
        )
      ORDER BY c.display_name ASC`,
    [uid]
  )
  return rows
}

export type JoinOrgWideResult =
  | { ok: true; channelId: string }
  | { ok: false; code: 'not_found' | 'not_org_wide' | 'not_in_org' | 'already_member' }

/**
 * Join an org-wide channel. Validates the channel is org-wide and active, that
 * the user shares its org via a sibling-workspace membership, and that the user
 * is not already a member.
 */
export async function joinOrgWideChannel(
  pool: Pool,
  uid: string,
  channelId: string
): Promise<JoinOrgWideResult> {
  const { rows } = await pool.query<{ is_org_wide: boolean; org_id: string | null; archived_at: string }>(
    `SELECT is_org_wide, org_id::text, archived_at::text FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  const ch = rows[0]
  if (!ch) return { ok: false, code: 'not_found' }
  if (!ch.is_org_wide || !ch.org_id || Number(ch.archived_at) > 0) {
    return { ok: false, code: 'not_org_wide' }
  }

  const { rows: sameOrg } = await pool.query(
    `SELECT 1
       FROM aaelink.workspaces w2
       JOIN aaelink.workspace_members m2
         ON m2.workspace_id = w2.id AND m2.user_id = $1
      WHERE w2.org_id = $2
      LIMIT 1`,
    [uid, ch.org_id]
  )
  if (sameOrg.length === 0) return { ok: false, code: 'not_in_org' }

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
