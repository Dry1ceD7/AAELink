import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

/**
 * Default Channel Helper
 *
 * Every Slack-class workspace needs a default "town-square" channel that:
 *   1. Is automatically created when a workspace is created.
 *   2. Every new member is automatically added to upon joining.
 *   3. Cannot be archived or deleted.
 *
 * AAELink uses `#general` as the default channel (Slack's equivalent).
 */

export const DEFAULT_CHANNEL_NAME = 'general'
export const DEFAULT_CHANNEL_DISPLAY_NAME = 'General'
export const DEFAULT_CHANNEL_PURPOSE = "This is the one channel that will always include everyone. It's a great spot for announcements and team-wide conversations."

/**
 * Ensures the default #general channel exists for a workspace.
 * Creates it if missing. Returns the channel ID.
 *
 * Safe to call multiple times — uses INSERT ON CONFLICT.
 */
export async function ensureDefaultChannel(
  pool: Pool,
  workspaceId: string,
  creatorId: string
): Promise<string> {
  const now = Date.now()

  // Check if #general already exists
  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.channels
     WHERE workspace_id = $1 AND name = $2 AND type = 'O'
     LIMIT 1`,
    [workspaceId, DEFAULT_CHANNEL_NAME]
  )

  if (existing[0]) return existing[0].id

  // Create #general
  const id = randomUUID()
  try {
    await pool.query(
      `INSERT INTO aaelink.channels
         (id, workspace_id, name, display_name, type, purpose, is_default, created_at)
       VALUES ($1, $2, $3, $4, 'O', $5, TRUE, $6)`,
      [id, workspaceId, DEFAULT_CHANNEL_NAME, DEFAULT_CHANNEL_DISPLAY_NAME, DEFAULT_CHANNEL_PURPOSE, now]
    )

    // Creator becomes channel admin
    await pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'admin', $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [id, creatorId, now]
    )

    return id
  } catch (e: unknown) {
    // Race condition — another request created it
    if ((e as { code?: string })?.code === '23505') {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM aaelink.channels
         WHERE workspace_id = $1 AND name = $2 AND type = 'O'
         LIMIT 1`,
        [workspaceId, DEFAULT_CHANNEL_NAME]
      )
      return rows[0]?.id || id
    }
    throw e
  }
}

/**
 * Auto-join a user to all default channels in a workspace.
 * Currently this is just #general, but could be extended with a
 * `is_default = TRUE` query for multiple default channels.
 */
export async function autoJoinDefaultChannels(
  pool: Pool,
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const now = Date.now()
  const joinedChannelIds: string[] = []

  // Find all default channels (is_default = TRUE)
  const { rows: defaultChannels } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.channels
     WHERE workspace_id = $1 AND is_default = TRUE AND archived_at IS NULL`,
    [workspaceId]
  )

  // Fallback: if no is_default channels, try #general by name
  if (defaultChannels.length === 0) {
    const { rows: generalChannel } = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.channels
       WHERE workspace_id = $1 AND name = $2 AND type = 'O'
       LIMIT 1`,
      [workspaceId, DEFAULT_CHANNEL_NAME]
    )
    if (generalChannel[0]) defaultChannels.push(generalChannel[0])
  }

  for (const ch of defaultChannels) {
    try {
      await pool.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [ch.id, userId, now]
      )
      joinedChannelIds.push(ch.id)
    } catch {
      // Best-effort — don't block workspace join on channel join failure
    }
  }

  return joinedChannelIds
}

/**
 * Checks if a channel is a default channel (cannot be archived/deleted).
 */
export async function isDefaultChannel(
  pool: Pool,
  channelId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ is_default: boolean }>(
    `SELECT COALESCE(is_default, FALSE) AS is_default
     FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  if (rows[0]?.is_default) return true

  // Also check by name for backwards compatibility
  const { rows: nameCheck } = await pool.query<{ name: string }>(
    `SELECT name FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  return nameCheck[0]?.name === DEFAULT_CHANNEL_NAME
}
