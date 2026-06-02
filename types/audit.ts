/**
 * Audit log types for AAELink.
 *
 * Mirrors and extends the action union from lib/enterprise/auditLog.ts.
 * Covers audit entries, streaming config, destinations, and export formats.
 * Type-only — no runtime code.
 *
 * @module types/audit
 */

/** All known audit action types. Extensible via string fallback. */
export type AuditAction =
  | 'message.create'
  | 'message.edit'
  | 'message.delete'
  | 'channel.create'
  | 'channel.delete'
  | 'channel.update'
  | 'channel.member.add'
  | 'channel.member.remove'
  | 'workspace.member.add'
  | 'workspace.member.remove'
  | 'user.login'
  | 'user.logout'
  | 'user.register'
  | 'user.update'
  | 'webhook.create'
  | 'webhook.delete'
  | 'webhook.trigger'
  | 'document.upload'
  | 'document.delete'
  | 'dlp.violation'
  | 'legal_hold.create'
  | 'legal_hold.release'
  | 'barrier.create'
  | 'barrier.update'

/** Target resource type that an audit action was performed on. */
export type AuditTargetType =
  | 'message'
  | 'channel'
  | 'user'
  | 'workspace'
  | 'webhook'
  | 'document'
  | 'policy'
  | 'legal_hold'
  | 'barrier'

/** Audit log entry representing a single audited event. */
export interface AuditEntry {
  /** Unique entry identifier. */
  id: string
  /** Workspace where the action occurred. */
  workspace_id: string
  /** User who performed the action. */
  actor_user_id: string
  /** Action performed. */
  action: AuditAction
  /** Type of target resource. */
  target_type: AuditTargetType
  /** Identifier of the target resource. */
  target_id: string
  /** Arbitrary metadata about the action. */
  metadata: Record<string, unknown>
  /** IP address of the actor. */
  ip: string
  /** Unix timestamp (ms) of the event. */
  timestamp: number
}

/** Supported audit stream destinations. */
export type AuditStreamDestination =
  | 'splunk'
  | 'elasticsearch'
  | 's3'
  | 'webhook'
  | 'syslog'

/** Supported audit export formats. */
export type AuditExportFormat =
  | 'json'
  | 'cef'
  | 'leef'

/** Audit stream configuration for real-time log forwarding. */
export interface AuditStreamConfig {
  /** Unique stream configuration identifier. */
  id: string
  /** Workspace this stream belongs to. */
  workspace_id: string
  /** Destination type for the stream. */
  destination_type: AuditStreamDestination
  /** Destination endpoint URL. */
  destination_url: string
  /** Export format for streamed events. */
  format: AuditExportFormat
  /** Whether this stream is currently active. */
  enabled: boolean
  /** High-water mark for last processed event (Unix ms). */
  watermark: number
}
