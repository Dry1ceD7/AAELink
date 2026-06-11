/**
 * Core enterprise domain types for AAELink.
 *
 * Defines organizations, membership, policies, plans, and feature flags.
 * Type-only — no runtime code.
 *
 * @module types/enterprise
 */

/** Enterprise plan tiers. */
export type EnterprisePlan =
  | 'free'
  | 'pro'
  | 'business_plus'
  | 'enterprise_grid'

/** Organization entity representing a top-level enterprise account. */
export interface Organization {
  /** Unique organization identifier. */
  id: string
  /** Display name of the organization. */
  name: string
  /** Primary domain (e.g. "acme.com"). */
  domain: string
  /** Current subscription plan. */
  plan: EnterprisePlan
  /** ISO-8601 creation timestamp. */
  created_at: string
  /** Organization-level settings. */
  settings: OrgSettings
}

/** Organization-level settings bag. */
export interface OrgSettings {
  /** Whether SSO is required for all members. */
  sso_required: boolean
  /** Default role assigned to new members. */
  default_member_role: OrgMemberRole
  /** Allowed email domains for signup. Empty = unrestricted. */
  allowed_domains: string[]
  /** Whether file uploads are permitted. */
  file_uploads_enabled: boolean
  /** Custom branding URL. */
  logo_url: string | null
}

/** Roles within an organization. */
export type OrgMemberRole =
  | 'org_owner'
  | 'org_admin'
  | 'member'

/** Organization membership record linking a user to an org. */
export interface OrgMember {
  /** User identifier. */
  user_id: string
  /** Organization identifier. */
  org_id: string
  /** Member's role within the organization. */
  role: OrgMemberRole
  /** ISO-8601 timestamp when user joined. */
  joined_at: string
}

/** Cascading organization policy configuration. */
export interface OrgPolicy {
  /** Unique policy identifier. */
  id: string
  /** Organization this policy belongs to. */
  org_id: string
  /** Message retention policy in days. 0 = indefinite. */
  retention_days: number
  /** Whether DLP scanning is enabled. */
  dlp_enabled: boolean
  /** Whether SSO is mandated for all workspaces. */
  sso_mandate: boolean
  /** Whether external sharing is permitted. */
  external_sharing_enabled: boolean
  /** Whether guest accounts are allowed. */
  guest_access_enabled: boolean
  /** ISO-8601 last update timestamp. */
  updated_at: string
}

/** Feature flag definition. */
export interface FeatureFlag {
  /** Unique flag key (e.g. "threads_v2"). */
  key: string
  /** Human-readable description. */
  description: string
  /** Default enabled state. */
  default_value: boolean
  /** Whether this flag is available for workspace-level override. */
  overridable: boolean
}

/** Workspace-level feature flag override. */
export interface FeatureFlagOverride {
  /** Flag key being overridden. */
  flag_key: string
  /** Workspace identifier. */
  workspace_id: string
  /** Overridden value. */
  value: boolean
  /** User who set the override. */
  set_by: string
  /** ISO-8601 timestamp of override. */
  set_at: string
}
