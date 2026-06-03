/**
 * D3 Messaging — channel type conversion (public <-> private).
 *
 * Slack lets a channel be converted between public ('O') and private ('P').
 * Conversion is performed by a channel owner/admin or an owner of the channel's
 * home workspace. DMs ('D') cannot be converted. A private channel cannot be
 * org-wide or multi-workspace-shared (those are public-only surfaces), so a
 * public channel that is currently shared must be un-shared/demoted first.
 */
import type { Pool } from 'pg'

interface ChannelActorRow {
  type: string
  is_org_wide: boolean
  workspace_id: string
  channel_role: string | null
  ws_role: string | null
}

async function loadChannelActor(
  pool: Pool,
  uid: string,
  channelId: string
): Promise<ChannelActorRow | null> {
  const { rows } = await pool.query<ChannelActorRow>(
    `SELECT c.type, c.is_org_wide, c.workspace_id,
            cm.role AS channel_role,
            wm.role AS ws_role
       FROM aaelink.channels c
       LEFT JOIN aaelink.channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
       LEFT JOIN aaelink.workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = $1
      WHERE c.id = $2`,
    [uid, channelId]
  )
  return rows[0] ?? null
}

export type ConvertChannelResult =
  | { ok: true; channelId: string; type: 'O' | 'P' }
  | {
      ok: false
      code:
        | 'not_found'
        | 'forbidden'
        | 'invalid_type'
        | 'same_type'
        | 'cannot_convert_dm'
        | 'org_wide_conflict'
        | 'shared_conflict'
    }

/**
 * Convert a channel to public ('O') or private ('P'). Owner/admin of the channel
 * or owner of its home workspace only. Rejects DM channels and refuses to make a
 * channel private while it is org-wide or shared into other workspaces.
 */
export async function convertChannelType(
  pool: Pool,
  uid: string,
  channelId: string,
  targetType: string
): Promise<ConvertChannelResult> {
  if (targetType !== 'O' && targetType !== 'P') return { ok: false, code: 'invalid_type' }

  const row = await loadChannelActor(pool, uid, channelId)
  if (!row) return { ok: false, code: 'not_found' }
  if (row.type === 'D') return { ok: false, code: 'cannot_convert_dm' }

  const isChannelAdmin = row.channel_role === 'owner' || row.channel_role === 'admin'
  const isWsOwner = row.ws_role === 'owner'
  if (!isChannelAdmin && !isWsOwner) return { ok: false, code: 'forbidden' }

  if (row.type === targetType) return { ok: false, code: 'same_type' }

  if (targetType === 'P') {
    if (row.is_org_wide) return { ok: false, code: 'org_wide_conflict' }
    const { rows: shared } = await pool.query(
      `SELECT 1 FROM aaelink.channel_workspaces WHERE channel_id = $1 LIMIT 1`,
      [channelId]
    )
    if (shared.length > 0) return { ok: false, code: 'shared_conflict' }
  }

  await pool.query(`UPDATE aaelink.channels SET type = $1 WHERE id = $2`, [targetType, channelId])
  return { ok: true, channelId, type: targetType }
}
