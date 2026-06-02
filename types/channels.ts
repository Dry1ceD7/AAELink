/**
 * Channel types for AAELink.
 *
 * Defines channel entities, types, membership, and member roles.
 * Type-only — no runtime code.
 *
 * @module types/channels
 */

/** Channel types matching Slack conventions. */
export type ChannelType =
  | 'public'
  | 'private'
  | 'dm'
  | 'group_dm'
  | 'shared'
  | 'org_shared'

/** Channel member roles within a channel. */
export type ChannelMemberRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'guest'

/** Channel entity representing a conversation space. */
export interface Channel {
  /** Unique channel identifier. */
  id: string
  /** Workspace this channel belongs to. */
  workspace_id: string
  /** Channel name (lowercase, no spaces). */
  name: string
  /** Channel type. */
  type: ChannelType
  /** Channel topic (displayed at top). */
  topic: string
  /** Channel purpose/description. */
  purpose: string
  /** User ID of the channel creator. */
  creator_id: string
  /** Whether this channel is archived. */
  is_archived: boolean
  /** Current number of members. */
  member_count: number
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Channel membership record linking a user to a channel. */
export interface ChannelMember {
  /** Channel identifier. */
  channel_id: string
  /** User identifier. */
  user_id: string
  /** Member's role within the channel. */
  role: ChannelMemberRole
  /** Whether notifications are muted. */
  muted: boolean
  /** Whether the channel is starred by this user. */
  starred: boolean
  /** Timestamp of the last message read by this user. */
  last_read_ts: string
}
