/**
 * SLA Engine — configurable response/resolution times per priority level.
 *
 * Default SLA targets (in milliseconds):
 *  - critical: 1h response / 4h resolution
 *  - high:     2h response / 8h resolution   (was "urgent")
 *  - medium:   4h response / 24h resolution
 *  - low:      8h response / 72h resolution
 */

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'
export type TicketStatus = 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed'
export type TicketCategory = 'general' | 'it_support' | 'hr' | 'finance' | 'sales' | 'facilities' | 'security'
export type TicketSource = 'ui' | 'email' | 'chat' | 'api'

const HOUR = 60 * 60 * 1000

export interface SlaTarget {
  response_ms: number
  resolution_ms: number
}

const DEFAULT_SLA: Record<TicketPriority, SlaTarget> = {
  critical: { response_ms: 1 * HOUR, resolution_ms: 4 * HOUR },
  high:     { response_ms: 2 * HOUR, resolution_ms: 8 * HOUR },
  medium:   { response_ms: 4 * HOUR, resolution_ms: 24 * HOUR },
  low:      { response_ms: 8 * HOUR, resolution_ms: 72 * HOUR },
}

export function isTicketPriority(v: string): v is TicketPriority {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical'
}

export function isTicketStatus(v: string): v is TicketStatus {
  return v === 'open' || v === 'pending' || v === 'in_progress' || v === 'resolved' || v === 'closed'
}

export function isTicketCategory(v: string): v is TicketCategory {
  return ['general', 'it_support', 'hr', 'finance', 'sales', 'facilities', 'security'].includes(v)
}

export function isTicketSource(v: string): v is TicketSource {
  return v === 'ui' || v === 'email' || v === 'chat' || v === 'api'
}

/** Get SLA target for a given priority. */
export function getSlaTarget(priority: TicketPriority): SlaTarget {
  return DEFAULT_SLA[priority] || DEFAULT_SLA.medium
}

/** Calculate the SLA due timestamp given ticket creation time and priority. */
export function calculateSlaDue(createdAt: number, priority: TicketPriority): number {
  const target = getSlaTarget(priority)
  return createdAt + target.resolution_ms
}

/** Determine SLA status based on current time vs due time. */
export function slaStatus(now: number, slaDueAt: number): 'ok' | 'warning' | 'breached' | 'none' {
  if (!slaDueAt || slaDueAt <= 0) return 'none'
  const remaining = slaDueAt - now
  if (remaining <= 0) return 'breached'
  // Warning when less than 25% of total time remains
  const total = slaDueAt - (slaDueAt - getSlaTarget('medium').resolution_ms)
  if (remaining < total * 0.25) return 'warning'
  return 'ok'
}

/** Format remaining time as human-readable string. */
export function formatSlaRemaining(now: number, slaDueAt: number): string {
  if (!slaDueAt || slaDueAt <= 0) return '—'
  const diff = slaDueAt - now
  if (diff <= 0) {
    const overdue = Math.abs(diff)
    if (overdue < HOUR) return `${Math.ceil(overdue / 60_000)}m overdue`
    if (overdue < 24 * HOUR) return `${Math.floor(overdue / HOUR)}h overdue`
    return `${Math.floor(overdue / (24 * HOUR))}d overdue`
  }
  if (diff < HOUR) return `${Math.ceil(diff / 60_000)}m left`
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}h ${Math.ceil((diff % HOUR) / 60_000)}m left`
  return `${Math.floor(diff / (24 * HOUR))}d ${Math.floor((diff % (24 * HOUR)) / HOUR)}h left`
}

/** Valid state transitions map. */
const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open:        ['pending', 'in_progress', 'closed'],
  pending:     ['open', 'in_progress', 'closed'],
  in_progress: ['pending', 'resolved', 'closed'],
  resolved:    ['open', 'in_progress', 'closed'],
  closed:      ['open'], // reopen
}

/** Check if a status transition is valid. */
export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/** Category-specific custom field definitions. */
export interface CustomFieldDef {
  key: string
  label: string
  type: 'text' | 'select' | 'number' | 'date'
  options?: string[]
  required?: boolean
}

const CATEGORY_FIELDS: Record<string, CustomFieldDef[]> = {
  it_support: [
    { key: 'device_type', label: 'Device Type', type: 'select', options: ['Laptop', 'Desktop', 'Phone', 'Printer', 'Network', 'Other'] },
    { key: 'os', label: 'Operating System', type: 'select', options: ['Windows', 'macOS', 'Linux', 'iOS', 'Android'] },
    { key: 'asset_tag', label: 'Asset Tag / Serial', type: 'text' },
  ],
  hr: [
    { key: 'request_type', label: 'Request Type', type: 'select', options: ['Leave', 'Benefits', 'Payroll', 'Onboarding', 'Offboarding', 'Other'] },
    { key: 'employee_id', label: 'Employee ID', type: 'text' },
  ],
  finance: [
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'currency', label: 'Currency', type: 'select', options: ['USD', 'EUR', 'GBP', 'THB', 'JPY'] },
    { key: 'invoice_number', label: 'Invoice Number', type: 'text' },
  ],
  sales: [
    { key: 'deal_value', label: 'Deal Value', type: 'number' },
    { key: 'client_name', label: 'Client Name', type: 'text' },
    { key: 'stage', label: 'Stage', type: 'select', options: ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] },
  ],
  facilities: [
    { key: 'location', label: 'Building / Floor', type: 'text' },
    { key: 'urgency_reason', label: 'Urgency Reason', type: 'text' },
  ],
  security: [
    { key: 'incident_type', label: 'Incident Type', type: 'select', options: ['Access Request', 'Data Breach', 'Phishing', 'Physical Security', 'Policy Violation', 'Other'] },
    { key: 'affected_systems', label: 'Affected Systems', type: 'text' },
  ],
}

/** Get custom fields for a ticket category. */
export function getCustomFieldsForCategory(category: string): CustomFieldDef[] {
  return CATEGORY_FIELDS[category] || []
}

/** Priority display configuration. */
export const PRIORITY_CONFIG: Record<TicketPriority, { label: string; color: string; iconKey: string }> = {
  critical: { label: 'Critical', color: '#dc2626', iconKey: 'alert-triangle' },
  high:     { label: 'High',     color: '#ea580c', iconKey: 'arrow-up' },
  medium:   { label: 'Medium',   color: '#ca8a04', iconKey: 'chevron-right' },
  low:      { label: 'Low',      color: '#16a34a', iconKey: 'arrow-down' },
}

/** Status display configuration. */
export const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string }> = {
  open:        { label: 'Open',        color: '#3b82f6' },
  pending:     { label: 'Pending',     color: '#f59e0b' },
  in_progress: { label: 'In Progress', color: '#8b5cf6' },
  resolved:    { label: 'Resolved',    color: '#22c55e' },
  closed:      { label: 'Closed',      color: '#6b7280' },
}

export const CATEGORY_CONFIG: Record<TicketCategory, { label: string; iconKey: string }> = {
  general:    { label: 'General',    iconKey: 'clipboard-list' },
  it_support: { label: 'IT Support', iconKey: 'monitor' },
  hr:         { label: 'HR',         iconKey: 'users' },
  finance:    { label: 'Finance',    iconKey: 'wallet' },
  sales:      { label: 'Sales',      iconKey: 'trending-up' },
  facilities: { label: 'Facilities', iconKey: 'building' },
  security:   { label: 'Security',   iconKey: 'shield' },
}

