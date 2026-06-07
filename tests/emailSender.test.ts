/**
 * AAELink — SMTP AUTH LOGIN base64 encoding invariant (lib/notifications/emailSender).
 *
 * RFC 4954 AUTH LOGIN carries base64-encoded credential tokens inside CRLF-
 * terminated SMTP command lines. The encoded token MUST be a single line — an
 * interior CR/LF would split the credential across two command lines and desync
 * the AUTH exchange. RFC 2045 MIME wraps base64 at 76 chars; Node's
 * Buffer.toString('base64') uses the unwrapped RFC 4648 alphabet and does NOT
 * wrap, so this holds even for very long credentials. These tests pin that.
 */
import { describe, it, expect } from 'vitest'
import { encodeSmtpAuth } from '@/lib/notifications/emailSender'

describe('encodeSmtpAuth — single-line base64 invariant', () => {
  it('round-trips a short credential', () => {
    const enc = encodeSmtpAuth('user@example.com')
    expect(Buffer.from(enc, 'base64').toString('utf8')).toBe('user@example.com')
  })

  it('produces no CR/LF inside the encoded value (short)', () => {
    const enc = encodeSmtpAuth('hunter2')
    expect(enc).not.toContain('\r')
    expect(enc).not.toContain('\n')
  })

  it('produces no CR/LF for a 100+ char username (would exceed the 76-char MIME wrap point)', () => {
    // 120 chars > 76 → MIME base64 (RFC 2045) would insert a soft line break here.
    const longUser = 'a'.repeat(120)
    const enc = encodeSmtpAuth(longUser)
    expect(enc.length).toBeGreaterThan(76) // long enough to trigger MIME wrapping if it existed
    expect(enc).not.toContain('\r')
    expect(enc).not.toContain('\n')
    expect(Buffer.from(enc, 'base64').toString('utf8')).toBe(longUser)
  })

  it('produces no CR/LF for a 200+ char password', () => {
    const longPass = 'P@ssw0rd!'.repeat(30) // 270 chars
    const enc = encodeSmtpAuth(longPass)
    expect(enc.length).toBeGreaterThan(200)
    expect(enc).not.toMatch(/[\r\n]/)
    expect(Buffer.from(enc, 'base64').toString('utf8')).toBe(longPass)
  })

  it('handles UTF-8 credentials without embedding line breaks', () => {
    const utf8Cred = 'pä$$wörd—🔐'.repeat(20)
    const enc = encodeSmtpAuth(utf8Cred)
    expect(enc).not.toMatch(/[\r\n]/)
    expect(Buffer.from(enc, 'base64').toString('utf8')).toBe(utf8Cred)
  })
})
