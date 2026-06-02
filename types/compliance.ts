/**
 * Compliance domain types for AAELink.
 *
 * Covers DLP rules/violations, legal holds, e-discovery exports,
 * and information barriers.
 * Type-only — no runtime code.
 *
 * @module types/compliance
 */

/** Action taken when a DLP rule matches. */
export type DlpAction =
  | 'alert'
  | 'block'
  | 'redact'
  | 'quarantine'

/** DLP rule severity levels. */
export type DlpSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'

/** Pattern matching strategy for DLP rules. */
export type DlpPatternType =
  | 'regex'
  | 'keyword'
  | 'dictionary'
  | 'classifier'

/** Data Loss Prevention rule definition. */
export interface DlpRule {
  /** Unique rule identifier. */
  id: string
  /** Human-readable rule name. */
  name: string
  /** How the pattern is matched. */
  pattern_type: DlpPatternType
  /** Pattern string (regex, keyword list, etc.). */
  pattern: string
  /** Action to take on match. */
  action: DlpAction
  /** Rule severity level. */
  severity: DlpSeverity
  /** Whether this rule is currently active. */
  enabled: boolean
}

/** Record of a DLP violation occurrence. */
export interface DlpViolation {
  /** Unique violation identifier. */
  id: string
  /** DLP rule that was triggered. */
  rule_id: string
  /** Message that triggered the violation. */
  message_id: string
  /** Channel where the violation occurred. */
  channel_id: string
  /** User who authored the violating message. */
  user_id: string
  /** Text snippet that matched the rule. */
  matched_text: string
  /** Action that was applied. */
  action_taken: DlpAction
  /** Unix timestamp (ms) when violation was detected. */
  timestamp: number
}

/** Legal hold status lifecycle. */
export type LegalHoldStatus =
  | 'active'
  | 'released'
  | 'expired'

/** Legal hold definition preserving data for litigation. */
export interface LegalHold {
  /** Unique hold identifier. */
  id: string
  /** Human-readable hold name. */
  name: string
  /** User IDs of custodians under hold. */
  custodian_ids: string[]
  /** Channel IDs included in hold scope. */
  channel_ids: string[]
  /** ISO-8601 start date of preservation. */
  start_date: string
  /** ISO-8601 end date of preservation (null = indefinite). */
  end_date: string | null
  /** Current hold status. */
  status: LegalHoldStatus
}

/** E-discovery export format. */
export type ExportFormat =
  | 'json'
  | 'csv'
  | 'mbox'

/** E-discovery export status lifecycle. */
export type EdiscoveryExportStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'

/** E-discovery export job for legal hold data extraction. */
export interface EdiscoveryExport {
  /** Unique export job identifier. */
  id: string
  /** Associated legal hold identifier. */
  legal_hold_id: string
  /** Export scope description. */
  scope: string
  /** Output format. */
  format: ExportFormat
  /** Current export status. */
  status: EdiscoveryExportStatus
  /** Download URL when completed (null until ready). */
  download_url: string | null
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Restrictions that can be applied by an information barrier. */
export type BarrierRestriction =
  | 'dm'
  | 'channel_join'
  | 'search'
  | 'file_share'

/** Information barrier preventing communication between groups. */
export interface InformationBarrier {
  /** Unique barrier identifier. */
  id: string
  /** First isolated group (user group IDs). */
  group_a: string[]
  /** Second isolated group (user group IDs). */
  group_b: string[]
  /** List of restrictions enforced by this barrier. */
  restrictions: BarrierRestriction[]
  /** Whether this barrier is currently enforced. */
  enabled: boolean
}
