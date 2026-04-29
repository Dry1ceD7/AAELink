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
 * True if the user can post to (write) a channel.
 * Currently identical to read access; split out so post-permissions can
 * be tightened independently (e.g. read-only announcement channels).
 */
export async function userCanPostToChannel(
  pool: Pool,
  userId: string,
  channelId: string
): Promise<boolean> {
  return userCanReadChannel(pool, userId, channelId)
}
