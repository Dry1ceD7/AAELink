/**
 * AAELink — SLA Engine Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import {
  isTicketPriority, isTicketStatus, isTicketCategory, isTicketSource,
  getSlaTarget, calculateSlaDue, slaStatus, formatSlaRemaining,
  isValidTransition, getCustomFieldsForCategory,
  PRIORITY_CONFIG, STATUS_CONFIG, CATEGORY_CONFIG,
  type TicketPriority, type TicketStatus, type TicketCategory,
} from '@/lib/enterprise/slaEngine'

const HOUR = 3_600_000
const MIN = 60_000

// ── Type guards — exhaustive ──────────────────────────────────────────

describe('SLA — isTicketPriority', () => {
  it.each(['low', 'medium', 'high', 'critical'] as const)('accepts %s', (p) => {
    expect(isTicketPriority(p)).toBe(true)
  })
  it.each(['urgent', 'none', '', '0', 'LOW', 'Critical'])('rejects %s', (v) => {
    expect(isTicketPriority(v)).toBe(false)
  })
})

describe('SLA — isTicketStatus', () => {
  it.each(['open', 'pending', 'in_progress', 'resolved', 'closed'] as const)('accepts %s', (s) => {
    expect(isTicketStatus(s)).toBe(true)
  })
  it.each(['done', 'active', 'cancelled', '', 'Open', 'CLOSED'])('rejects %s', (v) => {
    expect(isTicketStatus(v)).toBe(false)
  })
})

describe('SLA — isTicketCategory', () => {
  it.each(['general', 'it_support', 'hr', 'finance', 'sales', 'facilities', 'security'] as const)('accepts %s', (c) => {
    expect(isTicketCategory(c)).toBe(true)
  })
  it.each(['unknown', 'IT', 'HR', 'other', ''])('rejects %s', (v) => {
    expect(isTicketCategory(v)).toBe(false)
  })
})

describe('SLA — isTicketSource', () => {
  it.each(['ui', 'email', 'chat', 'api'] as const)('accepts %s', (s) => {
    expect(isTicketSource(s)).toBe(true)
  })
  it.each(['slack', 'sms', 'phone', '', 'UI'])('rejects %s', (v) => {
    expect(isTicketSource(v)).toBe(false)
  })
})

// ── SLA Targets ──────────────────────────────────────────────────────

describe('SLA — getSlaTarget', () => {
  it('critical: 1h response / 4h resolution', () => {
    const t = getSlaTarget('critical')
    expect(t.response_ms).toBe(1 * HOUR)
    expect(t.resolution_ms).toBe(4 * HOUR)
  })
  it('high: 2h response / 8h resolution', () => {
    const t = getSlaTarget('high')
    expect(t.response_ms).toBe(2 * HOUR)
    expect(t.resolution_ms).toBe(8 * HOUR)
  })
  it('medium: 4h response / 24h resolution', () => {
    const t = getSlaTarget('medium')
    expect(t.response_ms).toBe(4 * HOUR)
    expect(t.resolution_ms).toBe(24 * HOUR)
  })
  it('low: 8h response / 72h resolution', () => {
    const t = getSlaTarget('low')
    expect(t.response_ms).toBe(8 * HOUR)
    expect(t.resolution_ms).toBe(72 * HOUR)
  })
})

describe('SLA — calculateSlaDue', () => {
  it('adds resolution_ms to created time', () => {
    const created = 1_000_000
    expect(calculateSlaDue(created, 'critical')).toBe(created + 4 * HOUR)
    expect(calculateSlaDue(created, 'high')).toBe(created + 8 * HOUR)
    expect(calculateSlaDue(created, 'medium')).toBe(created + 24 * HOUR)
    expect(calculateSlaDue(created, 'low')).toBe(created + 72 * HOUR)
  })
  it('works with realistic timestamps', () => {
    const now = Date.now()
    const due = calculateSlaDue(now, 'high')
    expect(due - now).toBe(8 * HOUR)
  })
})

// ── SLA Status ──────────────────────────────────────────────────────

describe('SLA — slaStatus', () => {
  it('returns "ok" when plenty of time remains', () => {
    expect(slaStatus(Date.now(), Date.now() + 20 * HOUR)).toBe('ok')
  })
  it('returns "breached" when past due', () => {
    expect(slaStatus(Date.now(), Date.now() - HOUR)).toBe('breached')
  })
  it('returns "breached" when exactly at due time', () => {
    const now = Date.now()
    expect(slaStatus(now, now)).toBe('breached')
  })
  it('returns "none" for 0 due', () => {
    expect(slaStatus(Date.now(), 0)).toBe('none')
  })
  it('returns "none" for negative due', () => {
    expect(slaStatus(Date.now(), -100)).toBe('none')
  })
  it('returns "warning" when < 25% remaining', () => {
    // Medium resolution is 24h. SLA warning uses medium.resolution_ms (24h) as reference.
    // Warning threshold: remaining < 24h * 0.25 = 6h
    const now = Date.now()
    const due = now + 5 * HOUR // 5h left < 6h threshold
    expect(slaStatus(now, due)).toBe('warning')
  })
})

// ── Format SLA Remaining ──────────────────────────────────────────────

describe('SLA — formatSlaRemaining', () => {
  it('returns — for 0 due', () => {
    expect(formatSlaRemaining(Date.now(), 0)).toBe('—')
  })
  it('returns — for negative due', () => {
    expect(formatSlaRemaining(Date.now(), -1)).toBe('—')
  })
  it('shows minutes overdue for < 1h overdue', () => {
    const now = Date.now()
    const result = formatSlaRemaining(now, now - 30 * MIN)
    expect(result).toContain('m overdue')
  })
  it('shows hours overdue for < 24h overdue', () => {
    const now = Date.now()
    const result = formatSlaRemaining(now, now - 5 * HOUR)
    expect(result).toContain('h overdue')
  })
  it('shows days overdue for >= 24h overdue', () => {
    const now = Date.now()
    const result = formatSlaRemaining(now, now - 48 * HOUR)
    expect(result).toContain('d overdue')
  })
  it('shows minutes left for < 1h remaining', () => {
    const now = Date.now()
    const result = formatSlaRemaining(now, now + 45 * MIN)
    expect(result).toContain('m left')
  })
  it('shows hours and minutes left for < 24h remaining', () => {
    const now = Date.now()
    const result = formatSlaRemaining(now, now + 3 * HOUR + 15 * MIN)
    expect(result).toContain('h')
    expect(result).toContain('left')
  })
  it('shows days and hours left for >= 24h remaining', () => {
    const now = Date.now()
    const result = formatSlaRemaining(now, now + 50 * HOUR)
    expect(result).toContain('d')
    expect(result).toContain('left')
  })
})

// ── Valid Transitions — full matrix ───────────────────────────────────

describe('SLA — isValidTransition (full matrix)', () => {
  const validPairs: [TicketStatus, TicketStatus][] = [
    ['open', 'pending'],
    ['open', 'in_progress'],
    ['open', 'closed'],
    ['pending', 'open'],
    ['pending', 'in_progress'],
    ['pending', 'closed'],
    ['in_progress', 'pending'],
    ['in_progress', 'resolved'],
    ['in_progress', 'closed'],
    ['resolved', 'open'],
    ['resolved', 'in_progress'],
    ['resolved', 'closed'],
    ['closed', 'open'], // reopen
  ]
  it.each(validPairs)('%s → %s is valid', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true)
  })

  const invalidPairs: [TicketStatus, TicketStatus][] = [
    ['open', 'resolved'],   // must go through in_progress
    ['open', 'open'],       // self-transition
    ['pending', 'resolved'],
    ['pending', 'pending'],
    ['in_progress', 'open'],
    ['in_progress', 'in_progress'],
    ['resolved', 'pending'],
    ['resolved', 'resolved'],
    ['closed', 'pending'],
    ['closed', 'in_progress'],
    ['closed', 'resolved'],
    ['closed', 'closed'],
  ]
  it.each(invalidPairs)('%s → %s is invalid', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false)
  })
})

// ── Custom Fields ──────────────────────────────────────────────────────

describe('SLA — getCustomFieldsForCategory', () => {
  it('it_support has 3 fields', () => {
    const fields = getCustomFieldsForCategory('it_support')
    expect(fields).toHaveLength(3)
    expect(fields.map(f => f.key)).toEqual(['device_type', 'os', 'asset_tag'])
  })
  it('hr has 2 fields', () => {
    expect(getCustomFieldsForCategory('hr')).toHaveLength(2)
  })
  it('finance has 3 fields', () => {
    expect(getCustomFieldsForCategory('finance')).toHaveLength(3)
  })
  it('sales has 3 fields', () => {
    expect(getCustomFieldsForCategory('sales')).toHaveLength(3)
  })
  it('facilities has 2 fields', () => {
    expect(getCustomFieldsForCategory('facilities')).toHaveLength(2)
  })
  it('security has 2 fields', () => {
    expect(getCustomFieldsForCategory('security')).toHaveLength(2)
  })
  it('general returns empty', () => {
    expect(getCustomFieldsForCategory('general')).toEqual([])
  })
  it('unknown returns empty', () => {
    expect(getCustomFieldsForCategory('nonexistent')).toEqual([])
  })
  it('it_support device_type is a select', () => {
    const dt = getCustomFieldsForCategory('it_support').find(f => f.key === 'device_type')
    expect(dt?.type).toBe('select')
    expect(dt?.options).toContain('Laptop')
  })
  it('finance amount is a number type', () => {
    const amt = getCustomFieldsForCategory('finance').find(f => f.key === 'amount')
    expect(amt?.type).toBe('number')
  })
})

// ── Display Configs ──────────────────────────────────────────────────

describe('SLA — PRIORITY_CONFIG', () => {
  const priorities: TicketPriority[] = ['critical', 'high', 'medium', 'low']
  it.each(priorities)('%s has label, color, iconKey', (p) => {
    expect(PRIORITY_CONFIG[p].label).toBeTruthy()
    expect(PRIORITY_CONFIG[p].color).toMatch(/^#/)
    expect(PRIORITY_CONFIG[p].iconKey).toBeTruthy()
  })
})

describe('SLA — STATUS_CONFIG', () => {
  const statuses: TicketStatus[] = ['open', 'pending', 'in_progress', 'resolved', 'closed']
  it.each(statuses)('%s has label and color', (s) => {
    expect(STATUS_CONFIG[s].label).toBeTruthy()
    expect(STATUS_CONFIG[s].color).toMatch(/^#/)
  })
})

describe('SLA — CATEGORY_CONFIG', () => {
  const categories: TicketCategory[] = ['general', 'it_support', 'hr', 'finance', 'sales', 'facilities', 'security']
  it.each(categories)('%s has label and iconKey', (c) => {
    expect(CATEGORY_CONFIG[c].label).toBeTruthy()
    expect(CATEGORY_CONFIG[c].iconKey).toBeTruthy()
  })
})
