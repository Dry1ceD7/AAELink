/**
 * AAELink — Stirling PDF Tests
 *
 * Tests the getBaseUrl logic and assertUrl guard.
 */
import { describe, it, expect, vi } from 'vitest'

// Re-implement the private helpers for unit testing
function getBaseUrl(): string {
  return (process.env.STIRLING_URL || '').replace(/\/+$/, '')
}

function assertUrl(url: string) {
  if (!url) throw new Error('STIRLING_URL not configured')
}

describe('StirlingPdf — getBaseUrl', () => {
  it('returns empty string when env not set', () => {
    expect(getBaseUrl()).toBe('')
  })

  it('strips trailing slashes', () => {
    const orig = process.env.STIRLING_URL
    process.env.STIRLING_URL = 'http://stirling:8080///'
    expect(getBaseUrl()).toBe('http://stirling:8080')
    process.env.STIRLING_URL = orig
  })
})

describe('StirlingPdf — assertUrl', () => {
  it('throws when URL is empty', () => {
    expect(() => assertUrl('')).toThrow('STIRLING_URL not configured')
  })

  it('does not throw when URL is set', () => {
    expect(() => assertUrl('http://stirling:8080')).not.toThrow()
  })
})

describe('StirlingPdf — isStirlingAvailable (unconfigured)', () => {
  it('returns false without STIRLING_URL', async () => {
    const { isStirlingAvailable } = await import('@/lib/stirlingPdf')
    const result = await isStirlingAvailable()
    expect(result).toBe(false)
  })
})
