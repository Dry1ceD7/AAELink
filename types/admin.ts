/**
 * Admin types for AAELink.
 *
 * Defines roles, permissions, role assignments, invite requests,
 * device policies, session policies, and backup configuration
 * for the admin and security subsystem.
 * Type-only — no runtime code.
 *
 * @module types/admin
 */

/** Platform-level permission identifiers. */
export type Permission =
  | 'manage_channels'
  | 'manage_users'
  | 'manage_apps'
  | 'manage_workflows'
  | 'manage_compliance'
  | 'manage_billing'
  | 'manage_integrations'
  | 'manage_emoji'
  | 'view_analytics'
  | 'manage_security'
  | 'manage_org'

/** Scope at which a role assignment applies. */
export type AssignmentScope =
  | 'workspace'
  | 'org'
  | 'channel'

/** Invite request lifecycle status. */
export type InviteRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'

/** Backup job lifecycle status. */
export type BackupStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'

/** Admin role with a set of granted permissions. */
export interface AdminRole {
  /** Unique role identifier. */
  id: string
  /** Human-readable role name. */
  name: string
  /** Description of this role's purpose. */
  description: string
  /** Permissions granted by this role. */
  permissions: Permission[]
  /** Whether this is a custom (non-system) role. */
  is_custom: boolean
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Assignment of a role to a user within a scope. */
export interface RoleAssignment {
  /** Unique assignment identifier. */
  id: string
  /** Role being assigned. */
  role_id: string
  /** User receiving the role. */
  user_id: string
  /** Workspace context for the assignment. */
  workspace_id: string
  /** Scope at which the role applies. */
  scope: AssignmentScope
  /** User ID who created this assignment. */
  assigned_by: string
  /** ISO-8601 assignment timestamp. */
  assigned_at: string
}

/** Workspace membership invite request requiring admin review. */
export interface InviteRequest {
  /** Unique request identifier. */
  id: string
  /** Target workspace. */
  workspace_id: string
  /** Email address of the invitee. */
  email: string
  /** User ID who requested the invite. */
  requester_id: string
  /** Current request status. */
  status: InviteRequestStatus
  /** Admin who reviewed this request (null if pending). */
  reviewed_by: string | null
  /** ISO-8601 timestamp of review (null if pending). */
  reviewed_at: string | null
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Mobile/desktop device policy for a workspace. */
export interface DevicePolicy {
  /** Unique policy identifier. */
  id: string
  /** Workspace this policy applies to. */
  workspace_id: string
  /** Require device passcode/biometric. */
  require_passcode: boolean
  /** Allow jailbroken/rooted devices. */
  allow_jailbroken: boolean
  /** Minimum required OS version string (e.g. "16.0"). */
  min_os_version: string
  /** Require device-level encryption. */
  require_encryption: boolean
  /** Auto-lock timeout in minutes. */
  session_timeout_minutes: number
}

/** Session security policy for a workspace. */
export interface SessionPolicy {
  /** Unique policy identifier. */
  id: string
  /** Workspace this policy applies to. */
  workspace_id: string
  /** Maximum session duration in hours before forced re-auth. */
  max_session_duration_hours: number
  /** Idle timeout in minutes before session invalidation. */
  idle_timeout_minutes: number
  /** Whether MFA is required for all sessions. */
  require_mfa: boolean
  /** Force logout when user changes password. */
  force_logout_on_password_change: boolean
  /** Bind sessions to the originating IP address. */
  ip_binding: boolean
}

/** Workspace backup configuration. */
export interface BackupConfig {
  /** Unique configuration identifier. */
  id: string
  /** Workspace this backup config applies to. */
  workspace_id: string
  /** Cron expression for backup schedule. */
  schedule_cron: string
  /** Number of days to retain backup snapshots. */
  retention_days: number
  /** Backup storage destination identifier. */
  destination: string
  /** ISO-8601 timestamp of last completed backup (null if never). */
  last_backup_at: string | null
  /** Current backup job status. */
  status: BackupStatus
}
