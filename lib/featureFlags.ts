/**
 * Feature Flags — simple, type-safe feature flag system.
 *
 * Supports three resolution tiers:
 *   1. Environment variables (FEATURE_<FLAG_NAME>=true|false)
 *   2. Database overrides (aaelink.feature_flags table)
 *   3. Compile-time defaults (defined here)
 *
 * Usage:
 *   import { isFeatureEnabled, FeatureFlag } from '@/lib/featureFlags'
 *   if (await isFeatureEnabled('HUDDLES')) { ... }
 *
 * For client-side checks without DB access:
 *   import { isFeatureEnabledSync } from '@/lib/featureFlags'
 *   if (isFeatureEnabledSync('HUDDLES')) { ... }
 */

import { getPool } from '@/lib/db'

/* ── Flag definitions ─────────────────────────────────────────────────── */

/**
 * All feature flags and their compile-time defaults.
 * true  = enabled by default (opt-out via env or DB)
 * false = disabled by default (opt-in via env or DB)
 */
export const FEATURE_FLAGS = {
  /** Audio/video clip recording in message composer */
  AUDIO_VIDEO_CLIPS: true,

  /** Huddle (voice chat) panel in sidebar */
  HUDDLES: true,

  /** AI Summary panel */
  AI_SUMMARY: true,

  /** Slack Connect (cross-org) panel */
  SLACK_CONNECT: true,

  /** Workflow Builder automation */
  WORKFLOWS: true,

  /** Canvas collaborative editor */
  CANVAS_EDITOR: true,

  /** Marketplace plugin system */
  MARKETPLACE: true,

  /** Thread broadcast ("Also send to #channel") */
  THREAD_BROADCAST: true,

  /** Channel type conversion (Public ↔ Private) */
  CHANNEL_TYPE_CONVERSION: true,

  /** Activity feed panel */
  ACTIVITY_FEED: true,

  /** Custom emoji management */
  CUSTOM_EMOJI: true,

  /** Document assembly / PDF form filler */
  DOCUMENT_ASSEMBLY: true,

  /** Rate limiting on API routes */
  RATE_LIMITING: true,

  /** Link preview unfurling */
  LINK_PREVIEWS: true,

  /** Scheduled messages */
  SCHEDULED_MESSAGES: true,

  /** Reminders */
  REMINDERS: true,

  /** Approval workflows */
  APPROVALS: true,

  /** Knowledge Base wiki */
  KNOWLEDGE_BASE: true,

  /** Ticket system */
  TICKETS: true,

  /** Calendar / HR features */
  CALENDAR: true,

  /** SSO settings panel */
  SSO_SETTINGS: false,

  /** Enterprise: Data Loss Prevention */
  DLP: false,

  /** Enterprise: Encryption Key Management */
  EKM: false,

  /** Enterprise: Legal Holds */
  LEGAL_HOLD: false,

  /** Enterprise: Information Barriers */
  INFO_BARRIERS: false,

  /** Enterprise: SCIM provisioning */
  SCIM: false,

  /** Mobile push notifications */
  MOBILE_PUSH: false,

  /** WebRTC voice/video calls */
  WEBRTC_CALLS: false,
} as const

export type FeatureFlag = keyof typeof FEATURE_FLAGS

/* ── Sync check (env vars + defaults only — no DB) ─────────────────── */

/**
 * Check if a feature is enabled using environment variables and defaults.
 * No async, no DB call — safe for client components and middleware.
 */
export function isFeatureEnabledSync(flag: FeatureFlag): boolean {
  // 1. Check env var: FEATURE_HUDDLES=true|false
  const envKey = `FEATURE_${flag}`
  const envVal = process.env[envKey]?.toLowerCase()
  if (envVal === 'true' || envVal === '1') return true
  if (envVal === 'false' || envVal === '0') return false

  // Also check NEXT_PUBLIC_ variant for client-side
  const pubEnvVal = process.env[`NEXT_PUBLIC_${envKey}`]?.toLowerCase()
  if (pubEnvVal === 'true' || pubEnvVal === '1') return true
  if (pubEnvVal === 'false' || pubEnvVal === '0') return false

  // 2. Fall back to compile-time default
  return FEATURE_FLAGS[flag]
}

/* ── Async check (env + DB + defaults) ─────────────────────────────── */

// Cache DB overrides for 60s to avoid per-request DB calls
let _dbCache: Record<string, boolean> = {}
let _dbCacheExpiry = 0

async function loadDbFlags(): Promise<Record<string, boolean>> {
  if (Date.now() < _dbCacheExpiry) return _dbCache

  const pool = getPool()
  if (!pool) return {}

  try {
    const { rows } = await pool.query<{ flag_name: string; enabled: boolean }>(
      `SELECT flag_name, enabled FROM aaelink.feature_flags WHERE deleted_at IS NULL`
    )

    const flags: Record<string, boolean> = {}
    for (const row of rows) {
      flags[row.flag_name] = row.enabled
    }

    _dbCache = flags
    _dbCacheExpiry = Date.now() + 60_000 // Cache for 60 seconds
    return flags
  } catch {
    // Table may not exist yet — that's fine
    _dbCacheExpiry = Date.now() + 30_000 // Shorter cache on error
    return {}
  }
}

/**
 * Check if a feature is enabled (async — checks DB overrides too).
 * Resolution order: env var > DB override > compile-time default.
 */
export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
  // 1. Check env var first (highest priority)
  const envKey = `FEATURE_${flag}`
  const envVal = process.env[envKey]?.toLowerCase()
  if (envVal === 'true' || envVal === '1') return true
  if (envVal === 'false' || envVal === '0') return false

  // 2. Check DB override
  const dbFlags = await loadDbFlags()
  if (flag in dbFlags) return dbFlags[flag]

  // 3. Compile-time default
  return FEATURE_FLAGS[flag]
}

/* ── Bulk check ────────────────────────────────────────────────────── */

/**
 * Check multiple flags at once (single DB call).
 * Returns a record of flag → enabled.
 */
export async function getFeatureFlags(
  flags: FeatureFlag[]
): Promise<Record<FeatureFlag, boolean>> {
  const dbFlags = await loadDbFlags()
  const result: Partial<Record<FeatureFlag, boolean>> = {}

  for (const flag of flags) {
    const envKey = `FEATURE_${flag}`
    const envVal = process.env[envKey]?.toLowerCase()

    if (envVal === 'true' || envVal === '1') {
      result[flag] = true
    } else if (envVal === 'false' || envVal === '0') {
      result[flag] = false
    } else if (flag in dbFlags) {
      result[flag] = dbFlags[flag]
    } else {
      result[flag] = FEATURE_FLAGS[flag]
    }
  }

  return result as Record<FeatureFlag, boolean>
}

/**
 * Get ALL feature flags as a flat object (for admin dashboards).
 */
export async function getAllFeatureFlags(): Promise<Record<string, boolean>> {
  const allFlags = Object.keys(FEATURE_FLAGS) as FeatureFlag[]
  return getFeatureFlags(allFlags) as Promise<Record<string, boolean>>
}

/* ── Cache invalidation ────────────────────────────────────────────── */

/** Force-refresh the DB flag cache on the next check. */
export function invalidateFeatureFlagCache(): void {
  _dbCacheExpiry = 0
  _dbCache = {}
}
