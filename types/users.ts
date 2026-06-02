/**
 * User types for AAELink.
 *
 * Defines user entities, roles, status, profiles, and preferences.
 * Type-only — no runtime code.
 *
 * @module types/users
 */

/** User roles within a workspace. */
export type UserRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'guest'
  | 'bot'

/** Notification preference levels. */
export type NotificationLevel =
  | 'all'
  | 'mentions'
  | 'none'

/** Theme preference options. */
export type ThemePreference =
  | 'light'
  | 'dark'
  | 'system'

/** UI density options. */
export type DensityPreference =
  | 'compact'
  | 'comfortable'

/** User entity representing a workspace member. */
export interface User {
  /** Unique user identifier. */
  id: string
  /** Workspace this user belongs to. */
  workspace_id: string
  /** Email address. */
  email: string
  /** Display name shown in UI. */
  display_name: string
  /** Full real name. */
  real_name: string
  /** Avatar image URL. */
  avatar_url: string
  /** Custom status text. */
  status_text: string
  /** Custom status emoji shortcode. */
  status_emoji: string
  /** Workspace role. */
  role: UserRole
  /** IANA timezone identifier (e.g. "Asia/Bangkok"). */
  timezone: string
  /** Whether the user account is active. */
  is_active: boolean
  /** Whether this is a bot user. */
  is_bot: boolean
  /** ISO-8601 account creation timestamp. */
  created_at: string
}

/** Custom user status with optional expiration. */
export interface UserStatus {
  /** Status text. */
  text: string
  /** Status emoji shortcode. */
  emoji: string
  /** ISO-8601 expiration timestamp (null = no expiration). */
  expiration: string | null
}

/** Extended user profile information. */
export interface UserProfile {
  /** Job title. */
  title: string
  /** Phone number. */
  phone: string
  /** Department name. */
  department: string
  /** Manager's user ID (null if no manager). */
  manager_id: string | null
}

/** Sidebar section preference. */
export type SidebarSection =
  | 'channels'
  | 'dms'
  | 'apps'
  | 'starred'

/** User preference settings. */
export interface UserPreferences {
  /** Color theme preference. */
  theme: ThemePreference
  /** UI density preference. */
  density: DensityPreference
  /** Desktop notification level. */
  notifications: NotificationLevel
  /** Mobile push notification level. */
  mobile_notifications: NotificationLevel
  /** Sidebar sections ordering. */
  sidebar: SidebarSection[]
  /** Whether to show message previews. */
  message_preview: boolean
  /** Whether to use 24-hour time format. */
  time_format_24h: boolean
  /** Whether to mark messages as read on focus. */
  mark_read_on_focus: boolean
}
