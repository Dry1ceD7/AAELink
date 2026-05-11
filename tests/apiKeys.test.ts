/**
 * AAELink — API Key Management Tests
 *
 * Validates key generation, hashing, scope checking, and format.
 */
import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, keyPrefix, hasScope, type ValidatedKey } from '@/lib/apiKeys'

// ── Key Generation ───────────────────────────────────────────────────

describe('API Keys — Generation', () => {
  it('generates keys with read-only scope prefix', () => {
    const key = generateApiKey(['read'])
    expect(key).toMatch(/^aal_ro_[a-f0-9]{64}$/)
  })

  it('generates keys with read-write scope prefix', () => {
    const key = generateApiKey(['read', 'write'])
    expect(key).toMatch(/^aal_rw_[a-f0-9]{64}$/)
  })

  it('generates keys with admin scope prefix', () => {
    const key = generateApiKey(['admin'])
    expect(key).toMatch(/^aal_adm_[a-f0-9]{64}$/)
  })

  it('admin scope takes precedence over write in prefix', () => {
    const key = generateApiKey(['write', 'admin'])
    expect(key.startsWith('aal_adm_')).toBe(true)
  })

  it('generates unique keys each time', () => {
    const k1 = generateApiKey(['read'])
    const k2 = generateApiKey(['read'])
    expect(k1).not.toBe(k2)
  })
})

// ── Hashing ──────────────────────────────────────────────────────────

describe('API Keys — Hashing', () => {
  it('produces a 64-char hex SHA-256 hash', () => {
    const hash = hashApiKey('aal_ro_test123')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('same key always produces same hash', () => {
    const key = 'aal_rw_abcdef0123456789'
    expect(hashApiKey(key)).toBe(hashApiKey(key))
  })

  it('different keys produce different hashes', () => {
    expect(hashApiKey('key1')).not.toBe(hashApiKey('key2'))
  })
})

// ── Key Prefix ───────────────────────────────────────────────────────

describe('API Keys — Prefix', () => {
  it('extracts display prefix with ellipsis', () => {
    const key = generateApiKey(['read'])
    const prefix = keyPrefix(key)
    expect(prefix).toMatch(/^aal_ro_[a-f0-9]{5}\.\.\.$/)
    expect(prefix.length).toBe(15) // "aal_ro_" (7) + 5 hex + "..." (3)
  })
})

// ── Scope Checking ───────────────────────────────────────────────────

describe('API Keys — Scope Checking', () => {
  it('admin scope implies all permissions', () => {
    const key: ValidatedKey = { id: 'k1', user_id: 'u1', scopes: ['admin'], rate_limit_per_min: 60 }
    expect(hasScope(key, 'read')).toBe(true)
    expect(hasScope(key, 'write')).toBe(true)
    expect(hasScope(key, 'admin')).toBe(true)
  })

  it('write scope implies read', () => {
    const key: ValidatedKey = { id: 'k2', user_id: 'u1', scopes: ['write'], rate_limit_per_min: 60 }
    expect(hasScope(key, 'read')).toBe(true)
    expect(hasScope(key, 'write')).toBe(true)
    expect(hasScope(key, 'admin')).toBe(false)
  })

  it('read scope only allows read', () => {
    const key: ValidatedKey = { id: 'k3', user_id: 'u1', scopes: ['read'], rate_limit_per_min: 60 }
    expect(hasScope(key, 'read')).toBe(true)
    expect(hasScope(key, 'write')).toBe(false)
    expect(hasScope(key, 'admin')).toBe(false)
  })
})
