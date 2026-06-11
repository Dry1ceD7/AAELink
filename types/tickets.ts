/**
 * Ticket / IT service management types for AAELink.
 *
 * Aligns with slaEngine.ts and ticketRouter.ts definitions.
 * Type-only — no runtime code.
 *
 * @module types/tickets
 */

/** Ticket status lifecycle stages. */
export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending'
  | 'resolved'
  | 'closed'

/** Ticket priority levels. */
export type TicketPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'

/** Ticket categories matching ticketRouter.ts routing rules. */
export type TicketCategory =
  | 'general'
  | 'it_support'
  | 'hr'
  | 'finance'
  | 'sales'
  | 'facilities'
  | 'security'

/** Department identifiers for ticket routing. */
export type TicketDepartment =
  | 'engineering'
  | 'it'
  | 'hr'
  | 'finance'
  | 'sales'
  | 'facilities'
  | 'security'
  | 'general'

/** Ticket entity representing an IT service request or incident. */
export interface Ticket {
  /** Unique ticket identifier. */
  id: string
  /** Workspace this ticket belongs to. */
  workspace_id: string
  /** Short summary of the issue. */
  title: string
  /** Detailed description of the issue. */
  description: string
  /** Current ticket status. */
  status: TicketStatus
  /** Priority level. */
  priority: TicketPriority
  /** Category for routing. */
  category: TicketCategory
  /** User ID of the assigned agent (null if unassigned). */
  assignee_id: string | null
  /** User ID of the ticket creator. */
  creator_id: string
  /** Department responsible for resolution. */
  department: TicketDepartment
  /** SLA target configuration for this ticket. */
  sla_target: SlaTarget
  /** ISO-8601 creation timestamp. */
  created_at: string
  /** ISO-8601 last update timestamp. */
  updated_at: string
  /** ISO-8601 resolution timestamp (null if unresolved). */
  resolved_at: string | null
}

/** SLA target configuration specifying response and resolution time limits. */
export interface SlaTarget {
  /** Maximum time for first response in milliseconds. */
  response_time_ms: number
  /** Maximum time for resolution in milliseconds. */
  resolution_time_ms: number
  /** Whether SLA timers run only during business hours. */
  business_hours_only: boolean
}

/** Computed SLA compliance status. */
export type SlaStatus =
  | 'within_sla'
  | 'at_risk'
  | 'breached'

/** Record of a ticket state transition for audit trail. */
export interface TicketTransition {
  /** Unique transition record identifier. */
  id: string
  /** Ticket that transitioned. */
  ticket_id: string
  /** Previous status. */
  from_status: TicketStatus
  /** New status. */
  to_status: TicketStatus
  /** User who triggered the transition. */
  changed_by: string
  /** Optional reason for the transition. */
  reason: string | null
  /** Unix timestamp (ms) of the transition. */
  timestamp: number
}
