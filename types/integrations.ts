/**
 * Integration types for AAELink.
 *
 * Defines apps, bots, OAuth, webhooks, event subscriptions,
 * and plugin entities for the integration platform.
 * Type-only — no runtime code.
 *
 * @module types/integrations
 */

/** App lifecycle status. */
export type AppStatus =
  | 'active'
  | 'disabled'
  | 'pending_review'
  | 'rejected'

/** An installed workspace app (internal or third-party). */
export interface App {
  /** Unique app identifier. */
  id: string
  /** Workspace this app is installed in. */
  workspace_id: string
  /** Human-readable app name. */
  name: string
  /** Description of app functionality. */
  description: string
  /** URL to the app icon image. */
  icon_url: string
  /** URL to the app's homepage or docs. */
  homepage_url: string
  /** Whether this is an internally-developed app. */
  is_internal: boolean
  /** OAuth scopes granted to this app. */
  scopes: string[]
  /** User ID of the app's associated bot account. */
  bot_user_id: string | null
  /** User ID of the app creator. */
  creator_id: string
  /** Current app lifecycle status. */
  status: AppStatus
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Bot user associated with an installed app. */
export interface Bot {
  /** Unique bot identifier. */
  id: string
  /** App this bot belongs to. */
  app_id: string
  /** Workspace the bot operates in. */
  workspace_id: string
  /** Display name shown in messages. */
  display_name: string
  /** URL to the bot's avatar image. */
  avatar_url: string
  /** Whether the bot is currently active. */
  is_active: boolean
}

/** OAuth application registration for third-party integrations. */
export interface OAuthApp {
  /** Unique OAuth app identifier. */
  id: string
  /** OAuth client ID (public). */
  client_id: string
  /** Hashed client secret (never stored in plaintext). */
  client_secret_hash: string
  /** Human-readable app name. */
  name: string
  /** Allowed redirect URIs for the OAuth flow. */
  redirect_uris: string[]
  /** Permitted OAuth scopes. */
  scopes: string[]
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Issued OAuth token granting scoped access to the platform. */
export interface OAuthToken {
  /** Unique token record identifier. */
  id: string
  /** App this token was issued for. */
  app_id: string
  /** User who authorised this token. */
  user_id: string
  /** Workspace scope of the token. */
  workspace_id: string
  /** Granted scopes (space-delimited). */
  scopes: string
  /** SHA-256 hash of the token value. */
  token_hash: string
  /** ISO-8601 expiration timestamp. */
  expires_at: string
}

/** Incoming webhook endpoint for posting messages to a channel. */
export interface IncomingWebhook {
  /** Unique webhook identifier. */
  id: string
  /** Workspace this webhook belongs to. */
  workspace_id: string
  /** Target channel for incoming messages. */
  channel_id: string
  /** Unique webhook URL. */
  url: string
  /** Human-readable description. */
  description: string
  /** User ID who created this webhook. */
  creator_id: string
}

/** Event subscription for delivering platform events to an app. */
export interface EventSubscription {
  /** Unique subscription identifier. */
  id: string
  /** App receiving the events. */
  app_id: string
  /** List of event type strings to subscribe to. */
  event_types: string[]
  /** URL where events are POSTed. */
  request_url: string
  /** Subscription status (active, disabled). */
  status: string
}

/** Plugin definition in the plugin registry. */
export interface Plugin {
  /** Unique plugin identifier. */
  id: string
  /** Plugin name. */
  name: string
  /** Semantic version string. */
  version: string
  /** Description of plugin functionality. */
  description: string
  /** Plugin author name. */
  author: string
  /** JSON schema for plugin configuration options. */
  config_schema: Record<string, unknown>
  /** Whether this plugin is enabled globally. */
  is_enabled: boolean
}

/** Record of a plugin installed in a specific workspace. */
export interface InstalledPlugin {
  /** Unique installation record identifier. */
  id: string
  /** Plugin that was installed. */
  plugin_id: string
  /** Workspace the plugin is installed in. */
  workspace_id: string
  /** Plugin configuration values for this installation. */
  config: Record<string, unknown>
  /** User ID who installed the plugin. */
  installed_by: string
  /** ISO-8601 installation timestamp. */
  installed_at: string
}
