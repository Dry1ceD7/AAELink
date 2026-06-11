import type { Pool } from 'pg'

/**
 * Channel access guard used by every message / collab endpoint.
 *
 * Rules (matches Slack/Mattermost permission model):
 *  - Open channels  (type = 'O'): any workspace member may read/post.
 *  - Private channels (type = 'P'): only explicit channel_members rows.
 *  - DM channels    (type = 'D'): only the two participants (dm_user_a / dm_user_b).
 *  - Group DM       (type = 'G'): only explicit channel_members rows.
 *
 * Workspace admins (role = 'owner' | 'admin') can read all non-DM channels
 * in their workspace regardless of channel_members.
 */
export async function userCanReadChannel(
  pool: Pool,
  userId: string,
  channelId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM aaelink.channels c
     INNER JOIN aaelink.workspace_members wm
       ON wm.workspace_id = c.workspace_id AND wm.user_id = $2
     WHERE c.id = $1
       AND (
         /* Open channel — any workspace member */
         c.type = 'O'

         /* Private / Group-DM — must have explicit membership */
         OR (c.type IN ('P', 'G') AND EXISTS (
           SELECT 1 FROM aaelink.channel_members cm
           WHERE cm.channel_id = c.id AND cm.user_id = $2
         ))

         /* DM — must be one of the two participants */
         OR (c.type = 'D' AND (c.dm_user_a = $2 OR c.dm_user_b = $2))

         /* Workspace owner / admin bypasses private-channel gate */
         OR wm.role IN ('owner', 'admin')
       )`,
    [channelId, userId]
  )
  return rows.length > 0
}

/**
 * Batch variant of userCanReadChannel: given a list of candidate user ids and a
 * single channel, return only those who currently have read access. Runs ONE
 * query (no N+1) using the same access predicate as userCanReadChannel — open
 * channels are readable by any workspace member, private/group-DM require an
 * explicit channel_members row, DMs require participation, and workspace
 * owners/admins bypass the private-channel gate.
 *
 * Order of the input is not preserved; duplicates are collapsed.
 */
export async function filterUsersCanReadChannel(
  pool: Pool,
  userIds: string[],
  channelId: string
): Promise<string[]> {
  if (userIds.length === 0) return []
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT u.user_id
     FROM unnest($2::text[]) AS u(user_id)
     INNER JOIN aaelink.channels c ON c.id = $1
     INNER JOIN aaelink.workspace_members wm
       ON wm.workspace_id = c.workspace_id AND wm.user_id = u.user_id
     WHERE (
         /* Open channel — any workspace member */
         c.type = 'O'

         /* Private / Group-DM — must have explicit membership */
         OR (c.type IN ('P', 'G') AND EXISTS (
           SELECT 1 FROM aaelink.channel_members cm
           WHERE cm.channel_id = c.id AND cm.user_id = u.user_id
         ))

         /* DM — must be one of the two participants */
         OR (c.type = 'D' AND (c.dm_user_a = u.user_id OR c.dm_user_b = u.user_id))

         /* Workspace owner / admin bypasses private-channel gate */
         OR wm.role IN ('owner', 'admin')
       )`,
    [channelId, userIds]
  )
  return rows.map(r => r.user_id)
}

/**
 * True if the channel is archived and should block new posts.
 *
 * A channel is considered archived when:
 *   - archived_at != 0  (manual archive via channels PATCH action)
 *   - OR is_archived = true  (admin auto-archival boolean)
 */
export async function isChannelArchived(
  pool: Pool,
  channelId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ archived: boolean }>(
    `SELECT (archived_at != 0 OR COALESCE(is_archived, false)) AS archived
     FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  return rows[0]?.archived === true
}

/**
 * True if the user can post to (write) a channel.
 *
 * Enforces:
 *  1. userCanReadChannel — the user must have read access first.
 *  2. DM / Group-DM channels (type = 'D' | 'G') are always postable by their
 *     participants once read access passes — no posting_mode restrictions apply.
 *  3. posting_mode = 'everyone'    → allowed.
 *  4. posting_mode = 'admins_only' → channel_members.role IN ('admin','owner')
 *                                    OR workspace role IN ('admin','owner').
 *  5. posting_mode = 'approved'    → same as admins_only OR row in
 *                                    channel_approved_posters for this user.
 *
 * Note: this does NOT check archived state — callers that need the archived
 * guard must call isChannelArchived() separately (it is a distinct 403 code).
 */
export async function userCanPostToChannel(
  pool: Pool,
  userId: string,
  channelId: string
): Promise<boolean> {
  // Gate 1: must be able to read the channel at all
  if (!(await userCanReadChannel(pool, userId, channelId))) {
    return false
  }

  // Fetch channel type + posting_mode in one query
  const { rows: ch } = await pool.query<{
    type: string
    posting_mode: string
    workspace_id: string
  }>(
    `SELECT type, COALESCE(posting_mode, 'everyone') AS posting_mode, workspace_id
     FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  if (!ch[0]) return false

  const { type, posting_mode, workspace_id } = ch[0]

  // Gate 2: DM / Group-DM bypass posting_mode entirely
  if (type === 'D' || type === 'G') {
    return true
  }

  // Gate 3: everyone mode — any member that can read can post
  if (posting_mode === 'everyone') {
    return true
  }

  // Gates 4 & 5: admins_only and approved both allow channel-level admins/owners
  // and workspace-level admins/owners.

  // Check channel role
  const { rows: cmRows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, userId]
  )
  if (['admin', 'owner'].includes(cmRows[0]?.role || '')) {
    return true
  }

  // Check workspace role
  const { rows: wmRows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspace_id, userId]
  )
  if (['admin', 'owner'].includes(wmRows[0]?.role || '')) {
    return true
  }

  // Gate 5 extra: 'approved' mode allows explicitly approved posters
  if (posting_mode === 'approved') {
    const { rows: apRows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.channel_approved_posters
       WHERE channel_id = $1 AND user_id = $2`,
      [channelId, userId]
    )
    if (apRows.length > 0) {
      return true
    }
  }

  return false
}
