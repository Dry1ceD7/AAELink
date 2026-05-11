/**
 * AAELink — Ticket Router Exhaustive Tests (pure logic — detectCategory / detectPriority)
 */
import { describe, it, expect } from 'vitest'
import { detectCategory, detectPriority } from '@/lib/ticketRouter'

// ── detectCategory ──────────────────────────────────────────────────

describe('TicketRouter — detectCategory — IT Support', () => {
  it('detects password reset', () => {
    expect(detectCategory('Password issue', 'My password reset is not working')).toBe('it_support')
  })
  it('detects login issues', () => {
    expect(detectCategory('Cannot login', 'I cannot access my account')).toBe('it_support')
  })
  it('detects VPN problems', () => {
    expect(detectCategory('VPN not connecting', '')).toBe('it_support')
  })
  it('detects laptop issues', () => {
    expect(detectCategory('Laptop broken', '')).toBe('it_support')
  })
  it('detects printer issues', () => {
    expect(detectCategory('Printer jam', '')).toBe('it_support')
  })
  it('detects software install', () => {
    expect(detectCategory('Need software install', '')).toBe('it_support')
  })
  it('detects network/wifi', () => {
    expect(detectCategory('', 'The wifi and network are down')).toBe('it_support')
  })
  it('picks IT when multiple IT keywords match', () => {
    const cat = detectCategory('VPN and laptop issue', 'Cannot connect to network, wifi is down, software needs install')
    expect(cat).toBe('it_support')
  })
})

describe('TicketRouter — detectCategory — HR', () => {
  it('detects leave request', () => {
    expect(detectCategory('Leave request', 'I need to apply for vacation next week')).toBe('hr')
  })
  it('detects PTO', () => {
    expect(detectCategory('PTO Request', '')).toBe('hr')
  })
  it('detects sick leave', () => {
    expect(detectCategory('Sick day notification', '')).toBe('hr')
  })
  it('detects onboarding', () => {
    expect(detectCategory('New employee onboarding', '')).toBe('hr')
  })
  it('detects payroll', () => {
    expect(detectCategory('Payroll issue', 'Salary not received')).toBe('hr')
  })
  it('detects benefits', () => {
    expect(detectCategory('Benefits question', '')).toBe('hr')
  })
  it('detects resignation', () => {
    expect(detectCategory('Resignation notice', '')).toBe('hr')
  })
})

describe('TicketRouter — detectCategory — Finance', () => {
  it('detects expense reimbursement', () => {
    expect(detectCategory('Expense reimbursement', 'Please process my invoice')).toBe('finance')
  })
  it('detects payment', () => {
    expect(detectCategory('Payment pending', '')).toBe('finance')
  })
  it('detects budget', () => {
    expect(detectCategory('Budget approval needed', '')).toBe('finance')
  })
  it('detects purchase order', () => {
    expect(detectCategory('', 'Need a new purchase order for supplies')).toBe('finance')
  })
  it('detects billing', () => {
    expect(detectCategory('Billing error', '')).toBe('finance')
  })
  it('detects tax', () => {
    expect(detectCategory('Tax document request', '')).toBe('finance')
  })
  it('detects refund', () => {
    expect(detectCategory('', 'Customer wants a refund')).toBe('finance')
  })
})

describe('TicketRouter — detectCategory — Sales', () => {
  it('detects client proposal', () => {
    expect(detectCategory('New client proposal', 'Need a quote for the deal')).toBe('sales')
  })
  it('detects contract renewal', () => {
    expect(detectCategory('Contract renewal', '')).toBe('sales')
  })
  it('detects demo request', () => {
    expect(detectCategory('Demo request from prospect', '')).toBe('sales')
  })
  it('detects pricing', () => {
    expect(detectCategory('', 'Question about pricing and license')).toBe('sales')
  })
  it('detects subscription', () => {
    expect(detectCategory('Subscription upgrade', '')).toBe('sales')
  })
})

describe('TicketRouter — detectCategory — Facilities', () => {
  it('detects broken desk', () => {
    expect(detectCategory('Broken desk', 'The office chair in building B needs repair')).toBe('facilities')
  })
  it('detects parking', () => {
    expect(detectCategory('Parking permit', '')).toBe('facilities')
  })
  it('detects cleaning', () => {
    expect(detectCategory('Cleaning request', '')).toBe('facilities')
  })
  it('detects HVAC', () => {
    expect(detectCategory('', 'The hvac unit is not working')).toBe('facilities')
  })
  it('detects key card', () => {
    expect(detectCategory('Lost key card', '')).toBe('facilities')
  })
  it('detects door issue', () => {
    expect(detectCategory('', 'The door lock is broken')).toBe('facilities')
  })
})

describe('TicketRouter — detectCategory — Security', () => {
  it('detects suspicious email', () => {
    expect(detectCategory('Suspicious email', 'Possible phishing attempt detected')).toBe('security')
  })
  it('detects data breach', () => {
    expect(detectCategory('Data breach alert', '')).toBe('security')
  })
  it('detects malware', () => {
    expect(detectCategory('', 'Found malware on workstation')).toBe('security')
  })
  it('detects unauthorized + security keywords', () => {
    // "unauthorized" alone ties with IT "access", so we use a security-dominant combo
    expect(detectCategory('Unauthorized breach', 'vulnerability in the system')).toBe('security')
  })
  it('detects vulnerability', () => {
    expect(detectCategory('', 'New vulnerability discovered')).toBe('security')
  })
  it('detects compliance', () => {
    expect(detectCategory('Compliance audit', '')).toBe('security')
  })
})

describe('TicketRouter — detectCategory — General/Fallback', () => {
  it('defaults to general for unrelated text', () => {
    expect(detectCategory('Hello', 'Just a random question about the weather')).toBe('general')
  })
  it('defaults to general for empty strings', () => {
    expect(detectCategory('', '')).toBe('general')
  })
  it('is case insensitive', () => {
    expect(detectCategory('PASSWORD RESET', '')).toBe('it_support')
  })
})

// ── detectPriority ──────────────────────────────────────────────────

describe('TicketRouter — detectPriority', () => {
  it('detects "urgent" as critical', () => {
    expect(detectPriority('URGENT', '')).toBe('critical')
  })
  it('detects "emergency" as critical', () => {
    expect(detectPriority('', 'This is an emergency')).toBe('critical')
  })
  it('detects "critical" keyword as critical', () => {
    expect(detectPriority('Critical issue', '')).toBe('critical')
  })
  it('detects "outage" as critical', () => {
    expect(detectPriority('', 'Server outage detected')).toBe('critical')
  })
  it('detects "down" as critical', () => {
    expect(detectPriority('System down', '')).toBe('critical')
  })
  it('detects "breach" as critical', () => {
    expect(detectPriority('', 'Security breach in progress')).toBe('critical')
  })
  it('detects "data loss" as critical', () => {
    expect(detectPriority('', 'Experiencing data loss')).toBe('critical')
  })
  it('detects "production down" as critical', () => {
    expect(detectPriority('', 'Production down!')).toBe('critical')
  })
  it('detects "important" as high', () => {
    expect(detectPriority('Important request', '')).toBe('high')
  })
  it('detects "high priority" as high', () => {
    expect(detectPriority('High priority issue', '')).toBe('high')
  })
  it('detects "asap" as high', () => {
    expect(detectPriority('Need this asap', '')).toBe('high')
  })
  it('detects "blocking" as high', () => {
    expect(detectPriority('', 'This is blocking my work')).toBe('high')
  })
  it('detects "cannot work" as high', () => {
    expect(detectPriority('', 'I cannot work until this is fixed')).toBe('high')
  })
  it('detects "broken" as high', () => {
    expect(detectPriority('Broken feature', '')).toBe('high')
  })
  it('returns null for normal text', () => {
    expect(detectPriority('General question', 'How do I use the calendar?')).toBeNull()
  })
  it('critical takes precedence over high', () => {
    expect(detectPriority('Urgent and important', 'Emergency outage blocking everything')).toBe('critical')
  })
  it('is case insensitive', () => {
    expect(detectPriority('URGENT EMERGENCY', '')).toBe('critical')
  })
  it('returns null for empty strings', () => {
    expect(detectPriority('', '')).toBeNull()
  })
})
