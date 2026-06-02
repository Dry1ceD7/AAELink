import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'

/**
 * Information barrier enforcement.
 *
 * Prevents communication between users/groups that are separated
 * by an active information barrier. Used by the message pipeline
 * and channel-join logic to block restricted interactions.
 */

export interface InformationBarrier {
  id:               string
  name:             string
  type:             string
  group_a_ids:      string[]
  group_b_ids:      string[]
  block_dm:         boolean
  block_channels:   boolean
  block_search:     boolean
  block_file_share: boolean
  is_active:        boolean
}

export type BarrierRestriction = 'dm' | 'channel' | 'search' | 'file_share'

/** Load all active information barriers for a workspace. */
export async function getActiveBarriers(workspaceId: string): Promise<InformationBarrier[]> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return []
  // Barriers are global — not workspace-scoped in current schema.
  // Filter active only.
  const { rows } = await pool.query<InformationBarrier>(
    `SELECT * FROM aaelink.information_barriers WHERE is_active = true`
  )
  return rows
}

/**
 * Check if communication between two users is blocked by any barrier.
 * Returns the blocking barrier or null if allowed.
 */
export async function checkBarrier(
  userA: string,
  userB: string,
  workspaceId: string
): Promise<InformationBarrier | null> {
  const barriers = await getActiveBarriers(workspaceId)

  for (const b of barriers) {
    const aInGroupA = b.group_a_ids.includes(userA)
    const aInGroupB = b.group_b_ids.includes(userA)
    const bInGroupA = b.group_a_ids.includes(userB)
    const bInGroupB = b.group_b_ids.includes(userB)

    // Barrier applies when one user is in group A and the other in group B
    if ((aInGroupA && bInGroupB) || (aInGroupB && bInGroupA)) {
      return b
    }
  }
  return null
}

/**
 * Check if a specific user action on a target channel is blocked.
 * Resolves channel members against barrier groups.
 */
export async function isBlocked(
  userId: string,
  targetChannelId: string,
  restriction: BarrierRestriction
): Promise<boolean> {
  const pool = getPool()
  if (!pool) return false
  await ensureSchema()

  const barriers = await getActiveBarriers('')

  // Determine which barrier restrictions apply
  const activeBarriers = barriers.filter((b) => {
    switch (restriction) {
      case 'dm':         return b.block_dm
      case 'channel':    return b.block_channels
      case 'search':     return b.block_search
      case 'file_share': return b.block_file_share
      default:           return false
    }
  })

  if (activeBarriers.length === 0) return false

  // Get channel members
  const { rows: members } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.channel_members WHERE channel_id = $1`,
    [targetChannelId]
  )

  for (const b of activeBarriers) {
    const userInA = b.group_a_ids.includes(userId)
    const userInB = b.group_b_ids.includes(userId)
    if (!userInA && !userInB) continue

    for (const m of members) {
      if (m.user_id === userId) continue
      const memberInA = b.group_a_ids.includes(m.user_id)
      const memberInB = b.group_b_ids.includes(m.user_id)

      if ((userInA && memberInB) || (userInB && memberInA)) {
        return true
      }
    }
  }

  return false
}

/** Standard user-facing error message for barrier violations. */
export function getBarrierViolationMessage(): string {
  return 'This action is blocked by an information barrier policy. Contact your organization administrator for details.'
}
