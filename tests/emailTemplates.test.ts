/**
 * Unit tests for lib/emailTemplates.ts — Template rendering and validation
 */
import { describe, it, expect } from 'vitest'
import { renderEmail, listEmailTemplates } from '@/lib/comms/emailTemplates'

describe('Email Templates', () => {
  describe('listEmailTemplates()', () => {
    it('returns all available template names', () => {
      const templates = listEmailTemplates()
      expect(templates.length).toBeGreaterThanOrEqual(7)
      expect(templates).toContain('welcome')
      expect(templates).toContain('password_reset')
      expect(templates).toContain('invite')
      expect(templates).toContain('otp')
      expect(templates).toContain('mfa_enrolled')
      expect(templates).toContain('digest')
      expect(templates).toContain('legal_hold')
      expect(templates).toContain('new_device_login')
    })
  })

  describe('renderEmail()', () => {
    it('throws for unknown template', () => {
      expect(() => renderEmail('nonexistent' as never, {})).toThrow('Unknown email template')
    })

    it('renders welcome template with subject and HTML', () => {
      const result = renderEmail('welcome', { username: 'Alice', loginUrl: 'https://app.aaelink.test/login' })
      expect(result.subject).toContain('AAELink')
      expect(result.html).toContain('Alice')
      expect(result.html).toContain('https://app.aaelink.test/login')
      expect(result.html).toContain('<!DOCTYPE html>')
    })

    it('renders password_reset with reset link', () => {
      const result = renderEmail('password_reset', {
        username: 'Bob',
        resetUrl: 'https://app.aaelink.test/reset/abc123',
        expiresIn: '2 hours',
      })
      expect(result.subject).toContain('password')
      expect(result.html).toContain('Bob')
      expect(result.html).toContain('reset/abc123')
      expect(result.html).toContain('2 hours')
    })

    it('renders invite with workspace name and inviter', () => {
      const result = renderEmail('invite', {
        inviterName: 'Charlie',
        workspaceName: 'Engineering',
        inviteUrl: 'https://app.aaelink.test/invite/xyz',
      })
      expect(result.subject).toContain('Charlie')
      expect(result.subject).toContain('Engineering')
      expect(result.html).toContain('Engineering')
      expect(result.html).toContain('invite/xyz')
    })

    it('renders OTP with verification code', () => {
      const result = renderEmail('otp', {
        username: 'Dave',
        code: '847291',
        expiresIn: '10 minutes',
      })
      expect(result.subject).toContain('verification')
      expect(result.html).toContain('847291')
      expect(result.html).toContain('10 minutes')
    })

    it('renders MFA enrolled notification', () => {
      const result = renderEmail('mfa_enrolled', { username: 'Eve', method: 'totp' })
      expect(result.subject).toContain('MFA')
      expect(result.html).toContain('TOTP')
      expect(result.html).toContain('Eve')
    })

    it('renders digest with unread counts', () => {
      const result = renderEmail('digest', {
        username: 'Frank',
        unreadChannels: 3,
        unreadDMs: 1,
        mentionCount: 5,
        loginUrl: 'https://app.aaelink.test',
      })
      expect(result.subject).toContain('5 mention')
      expect(result.html).toContain('Frank')
    })

    it('renders legal hold notice', () => {
      const result = renderEmail('legal_hold', {
        username: 'Grace',
        holdName: 'Case #2024-Q1',
        startDate: '2024-03-15',
      })
      expect(result.subject).toContain('Legal Hold')
      expect(result.html).toContain('Case #2024-Q1')
      expect(result.html).toContain('2024-03-15')
      expect(result.html).toContain('Do not delete')
    })

    it('renders new device login alert', () => {
      const result = renderEmail('new_device_login', {
        username: 'Heidi',
        deviceName: 'Chrome on macOS',
        ipAddress: '203.0.113.42',
        location: 'Bangkok, TH',
        loginTime: '2024-03-15 14:30 UTC',
      })
      expect(result.subject).toContain('Chrome on macOS')
      expect(result.html).toContain('203.0.113.42')
      expect(result.html).toContain('Bangkok')
    })

    it('escapes HTML in user-provided values', () => {
      const result = renderEmail('welcome', {
        username: '<script>alert("xss")</script>',
        loginUrl: 'https://app.aaelink.test',
      })
      expect(result.html).not.toContain('<script>')
      expect(result.html).toContain('&lt;script&gt;')
    })

    it('produces valid HTML structure for all templates', () => {
      const templates = listEmailTemplates()
      const testVars: Record<string, Record<string, string | number | boolean | undefined>> = {
        welcome: { username: 'Test', loginUrl: 'https://test.test' },
        mfa_enrolled: { username: 'Test', method: 'totp' },
        password_reset: { username: 'Test', resetUrl: 'https://test.test', expiresIn: '1h' },
        invite: { inviterName: 'A', workspaceName: 'W', inviteUrl: 'https://test.test' },
        digest: { username: 'T', unreadChannels: 1, unreadDMs: 0, mentionCount: 2, loginUrl: 'https://test.test' },
        legal_hold: { username: 'T', holdName: 'H', startDate: '2024-01-01' },
        otp: { username: 'T', code: '123456', expiresIn: '5m' },
        new_device_login: { username: 'T', deviceName: 'D', ipAddress: '1.2.3.4', location: 'L', loginTime: 'T' },
      }

      for (const t of templates) {
        const vars = testVars[t] || {}
        const result = renderEmail(t, vars)
        expect(result.subject).toBeTruthy()
        expect(result.html).toContain('<!DOCTYPE html>')
        expect(result.html).toContain('</html>')
        expect(result.html).toContain('Advanced ID Asia Engineering')
      }
    })
  })
})
