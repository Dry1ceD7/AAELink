/**
 * AAELink — Audit Log & IP Extraction Tests
 */
import { describe, it, expect } from 'vitest'
import { extractIp } from '@/lib/enterprise/auditLog'

describe('AuditLog — extractIp', () => {
  it('reads x-forwarded-for', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
    })
    expect(extractIp(req)).toBe('203.0.113.50')
  })

  it('reads x-real-ip fallback', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '10.0.0.5' },
    })
    expect(extractIp(req)).toBe('10.0.0.5')
  })

  it('prefers x-forwarded-for over x-real-ip', () => {
    const req = new Request('http://localhost', {
      headers: {
        'x-forwarded-for': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
      },
    })
    expect(extractIp(req)).toBe('1.1.1.1')
  })

  it('returns empty for no IP headers', () => {
    const req = new Request('http://localhost')
    expect(extractIp(req)).toBe('')
  })

  it('trims whitespace', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '  8.8.8.8  ' },
    })
    expect(extractIp(req)).toBe('8.8.8.8')
  })
})
