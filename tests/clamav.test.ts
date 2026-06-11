/**
 * AAELink — ClamAV INSTREAM response parsing tests.
 *
 * Verifies that raw clamd replies map to the correct verdict, and that
 * anything unrecognized (or an error) is NEVER treated as clean.
 */
import { describe, it, expect } from 'vitest'
import { parseClamResponse } from '@/lib/files/clamav'

describe('ClamAV — parseClamResponse', () => {
  it('parses a clean reply', () => {
    const r = parseClamResponse('stream: OK\0')
    expect(r.verdict).toBe('clean')
    expect(r.threatName).toBe('')
  })

  it('parses an infected reply and extracts the threat name', () => {
    const r = parseClamResponse('stream: Eicar-Test-Signature FOUND\0')
    expect(r.verdict).toBe('infected')
    expect(r.threatName).toBe('Eicar-Test-Signature')
  })

  it('handles multi-word threat names', () => {
    const r = parseClamResponse('stream: Win.Trojan.Generic-9999 FOUND\0')
    expect(r.verdict).toBe('infected')
    expect(r.threatName).toBe('Win.Trojan.Generic-9999')
  })

  it('treats ERROR replies as unknown (never clean)', () => {
    const r = parseClamResponse('INSTREAM size limit exceeded ERROR\0')
    expect(r.verdict).toBe('unknown')
  })

  it('treats empty/garbage replies as unknown (never clean)', () => {
    expect(parseClamResponse('').verdict).toBe('unknown')
    expect(parseClamResponse('\0\0').verdict).toBe('unknown')
    expect(parseClamResponse('weird unexpected text').verdict).toBe('unknown')
  })

  it('does not misread a FOUND line as clean even though it contains no OK', () => {
    const r = parseClamResponse('stream: Foo.Bar FOUND')
    expect(r.verdict).toBe('infected')
  })
})
