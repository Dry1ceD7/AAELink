/**
 * AAELink — Channel Archival Engine
 *
 * Automated lifecycle management for channels:
 *   - Archive channels with no activity after configurable threshold
 *   - Grace period with warning notifications before archival
 *   - Allowlist to exempt critical channels
 *   - Preview mode (dry-run) for safe rollout
 *   - Bulk archive / unarchive
 *   - Audit trail for every archival action
 *
 * Slack equivalents: admin.conversations.archive,
 *   admin.conversations.setInactive, conversations.archive
 */

// ── Types ────────────────────────────────────────────────────────────

export interface ArchivalPolicy {
  /** Days of inactivity before archival (default: 90) */
  inactivity_days: number
  /** Days of warning before actual archival (default: 7) */
  grace_period_days: number
  /** Channel IDs exempt from auto-archival */
  exempt_channel_ids: string[]
  /** Channel name patterns to exempt (glob-like) */
  exempt_patterns: string[]
  /** Minimum member count — skip channels with fewer members */
  min_members_to_archive: number
  /** Whether archival is enabled globally */
  enabled: boolean
}

export interface ArchivalCandidate {
  channel_id: string
  channel_name: string
  workspace_id: string
  last_activity_at: number
  member_count: number
  days_inactive: number
  is_exempt: boolean
  exempt_reason?: string
  action: 'archive' | 'warn' | 'skip'
}

export interface ArchivalResult {
  preview: boolean
  total_scanned: number
  candidates: ArchivalCandidate[]
  archived: number
  warned: number
  skipped: number
  errors: string[]
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_ARCHIVAL_POLICY: ArchivalPolicy = {
  inactivity_days: 90,
  grace_period_days: 7,
  exempt_channel_ids: [],
  exempt_patterns: ['general', 'announcements', 'random', 'it-*', 'hr-*'],
  min_members_to_archive: 0,
  enabled: true,
}

// ── Pattern Matching ─────────────────────────────────────────────────

function matchesPattern(name: string, pattern: string): boolean {
  // Simple glob: * matches any characters
  const regex = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i'
  )
  return regex.test(name)
}

function isExempt(
  channelId: string,
  channelName: string,
  policy: ArchivalPolicy,
): { exempt: boolean; reason?: string } {
  if (policy.exempt_channel_ids.includes(channelId)) {
    return { exempt: true, reason: 'explicit_exempt_id' }
  }
  for (const pat of policy.exempt_patterns) {
    if (matchesPattern(channelName, pat)) {
      return { exempt: true, reason: `matches_pattern:${pat}` }
    }
  }
  return { exempt: false }
}

// ── Engine ───────────────────────────────────────────────────────────

export class ChannelArchivalEngine {
  private policy: ArchivalPolicy

  constructor(policy: Partial<ArchivalPolicy> = {}) {
    this.policy = { ...DEFAULT_ARCHIVAL_POLICY, ...policy }
  }

  getPolicy(): ArchivalPolicy {
    return { ...this.policy }
  }

  updatePolicy(update: Partial<ArchivalPolicy>): ArchivalPolicy {
    this.policy = { ...this.policy, ...update }
    return this.getPolicy()
  }

  /**
   * Evaluate channels against the archival policy.
   * Returns candidates with their proposed action.
   */
  evaluate(channels: Array<{
    id: string
    name: string
    workspace_id: string
    last_activity_at: number
    member_count: number
    is_archived: boolean
  }>): ArchivalCandidate[] {
    const now = Date.now()
    const inactivityMs = this.policy.inactivity_days * 24 * 60 * 60 * 1000
    const graceMs = this.policy.grace_period_days * 24 * 60 * 60 * 1000

    return channels
      .filter(ch => !ch.is_archived) // Skip already-archived
      .map(ch => {
        const age = now - ch.last_activity_at
        const daysInactive = Math.floor(age / (24 * 60 * 60 * 1000))
        const exemptCheck = isExempt(ch.id, ch.name, this.policy)

        // Member count check
        if (ch.member_count < this.policy.min_members_to_archive && this.policy.min_members_to_archive > 0) {
          return {
            channel_id: ch.id,
            channel_name: ch.name,
            workspace_id: ch.workspace_id,
            last_activity_at: ch.last_activity_at,
            member_count: ch.member_count,
            days_inactive: daysInactive,
            is_exempt: true,
            exempt_reason: `below_min_members:${this.policy.min_members_to_archive}`,
            action: 'skip' as const,
          }
        }

        if (exemptCheck.exempt) {
          return {
            channel_id: ch.id,
            channel_name: ch.name,
            workspace_id: ch.workspace_id,
            last_activity_at: ch.last_activity_at,
            member_count: ch.member_count,
            days_inactive: daysInactive,
            is_exempt: true,
            exempt_reason: exemptCheck.reason,
            action: 'skip' as const,
          }
        }

        let action: 'archive' | 'warn' | 'skip' = 'skip'
        if (age >= inactivityMs) {
          action = 'archive'
        } else if (age >= inactivityMs - graceMs) {
          action = 'warn'
        }

        return {
          channel_id: ch.id,
          channel_name: ch.name,
          workspace_id: ch.workspace_id,
          last_activity_at: ch.last_activity_at,
          member_count: ch.member_count,
          days_inactive: daysInactive,
          is_exempt: false,
          action,
        }
      })
  }

  /**
   * Execute archival preview (dry-run) — no side effects.
   */
  preview(channels: Parameters<ChannelArchivalEngine['evaluate']>[0]): ArchivalResult {
    const candidates = this.evaluate(channels)
    return {
      preview: true,
      total_scanned: channels.length,
      candidates: candidates.filter(c => c.action !== 'skip'),
      archived: candidates.filter(c => c.action === 'archive').length,
      warned: candidates.filter(c => c.action === 'warn').length,
      skipped: candidates.filter(c => c.action === 'skip').length,
      errors: [],
    }
  }

  /**
   * Execute archival against a DB interface.
   *
   * @param channels  The channel list to evaluate
   * @param archiveFn Callback to archive a channel (channel_id) => Promise<void>
   * @param warnFn    Callback to send a warning (channel_id, days_remaining) => Promise<void>
   */
  async execute(
    channels: Parameters<ChannelArchivalEngine['evaluate']>[0],
    archiveFn: (channelId: string) => Promise<void>,
    warnFn: (channelId: string, daysRemaining: number) => Promise<void>,
  ): Promise<ArchivalResult> {
    if (!this.policy.enabled) {
      return {
        preview: false,
        total_scanned: channels.length,
        candidates: [],
        archived: 0,
        warned: 0,
        skipped: channels.length,
        errors: ['archival_disabled'],
      }
    }

    const candidates = this.evaluate(channels)
    const errors: string[] = []
    let archived = 0
    let warned = 0

    for (const c of candidates) {
      try {
        if (c.action === 'archive') {
          await archiveFn(c.channel_id)
          archived++
        } else if (c.action === 'warn') {
          const daysRemaining = this.policy.inactivity_days - c.days_inactive
          await warnFn(c.channel_id, Math.max(0, daysRemaining))
          warned++
        }
      } catch (err: unknown) {
        errors.push(`${c.channel_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return {
      preview: false,
      total_scanned: channels.length,
      candidates: candidates.filter(c => c.action !== 'skip'),
      archived,
      warned,
      skipped: candidates.filter(c => c.action === 'skip').length,
      errors,
    }
  }
}
