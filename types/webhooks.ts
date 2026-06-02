/**
 * Webhook types for AAELink.
 *
 * Defines webhook configuration, event types, delivery logs, and status.
 * Type-only — no runtime code.
 *
 * @module types/webhooks
 */

/** Webhook event types that can trigger delivery. */
export type WebhookEvent =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'channel.created'
  | 'channel.updated'
  | 'channel.deleted'
  | 'channel.member.joined'
  | 'channel.member.left'
  | 'user.joined'
  | 'user.updated'
  | 'user.deactivated'
  | 'reaction.added'
  | 'reaction.removed'
  | 'file.uploaded'
  | 'file.deleted'
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'

/** Webhook configuration entity. */
export interface Webhook {
  /** Unique webhook identifier. */
  id: string
  /** Workspace this webhook belongs to. */
  workspace_id: string
  /** Destination URL for event delivery. */
  url: string
  /** Event types this webhook subscribes to. */
  events: WebhookEvent[]
  /** HMAC signing secret for payload verification. */
  secret: string
  /** Whether this webhook is active. */
  enabled: boolean
  /** Consecutive delivery failure count. */
  failure_count: number
  /** ISO-8601 timestamp of last successful delivery (null if never delivered). */
  last_delivery_at: string | null
}

/** Webhook delivery status. */
export type WebhookDeliveryStatus =
  | 'success'
  | 'failed'
  | 'retrying'
  | 'dlq'

/** Webhook delivery log entry. */
export interface WebhookDelivery {
  /** Unique delivery identifier. */
  id: string
  /** Webhook that triggered this delivery. */
  webhook_id: string
  /** Event type that was delivered. */
  event: WebhookEvent
  /** Serialized event payload. */
  payload: Record<string, unknown>
  /** HTTP response status code from the destination. */
  status_code: number
  /** HTTP response body from the destination. */
  response_body: string
  /** Round-trip delivery duration in milliseconds. */
  duration_ms: number
  /** Delivery status. */
  status: WebhookDeliveryStatus
  /** Unix timestamp (ms) of the delivery attempt. */
  timestamp: number
}
