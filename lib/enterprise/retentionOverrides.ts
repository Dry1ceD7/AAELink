/**
 * Per-channel retention overrides (Slack admin.conversations.setCustomRetention
 * parity). A workspace/channel/dm scope policy (retention_policies) sets the
 * default window; a per-channel override (channel_retention_overrides) takes
 * precedence for THAT channel only. Absence of an override falls back to the
 * scope policy. An override with enabled=false is a no-op (falls back).
 *
 * Enforcement contract (see retentionJob.runRetentionEnforcement):
 *   - The scope-policy message delete EXCLUDES every overridden channel so the
 *     override window — never the scope window — governs those channels.
 *   - Each enabled override then runs its own hold-aware delete for its channel.
 *
 * Legal holds are ALWAYS respected: the same buildHoldExclusion the scope path
 * uses is applied here, so held content is never purged regardless of override.
 *
 * Schema (migration 050_channel_retention_overrides):
 *   channel_retention_overrides(channel_id TEXT PK -> channels.id ON DELETE
 *   CASCADE, retention_days INT, enabled BOOL, created_at/updated_at TIMESTAMPTZ,
 *   updated_by TEXT -> users.id ON DELETE SET NULL)
 */
import type { Pool } from 'pg'
import { cutoffForPolicy, buildHoldExclusion, type ActiveHold } from './retentionEnforcer'

export interface ChannelRetentionOverride {
  channelId: string
  retentionDays: number
  enabled: boolean
}

/**
 * Load enabled overrides with a positive window — the only ones that drive a
 * delete. Disabled / zero-day rows are ignored (zero days = keep-forever, same
 * semantics as the scope policies).
 */
export async function loadActiveChannelOverrides(pool: Pool): Promise<ChannelRetentionOverride[]> {
  const { rows } = await pool.query<{
    channel_id: string; retention_days: number | string; enabled: boolean
  }>(
    `SELECT channel_id, retention_days, enabled
       FROM aaelink.channel_retention_overrides
      WHERE enabled = true AND retention_days > 0`
  )
  return rows.map((r) => ({
    channelId: r.channel_id,
    retentionDays: Number(r.retention_days),
    enabled: r.enabled,
  }))
}

/**
 * Delete messages in a single overridden channel older than the override's
 * window, excluding any content under an active legal hold. Returns the row
 * count deleted. Params: $1 cutoff, $2 channel_id, then hold params at $3.
 */
export async function deleteOverriddenChannelMessages(
  pool: Pool,
  override: ChannelRetentionOverride,
  holds: ActiveHold[],
  now = Date.now()
): Promise<number> {
  const cutoffMs = cutoffForPolicy(override.retentionDays, now)
  // Hold exclusion keys off m.channel_id / m.created_at / m.user_id. The channel
  // filter consumes $2, so hold params start at $3.
  const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 3, 'm.user_id')
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.messages m
      WHERE m.channel_id = $2
        AND m.created_at < $1${ex.clause}`,
    [cutoffMs, override.channelId, ...ex.params]
  )
  return rowCount || 0
}
