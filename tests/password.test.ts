/**
 * AAELink — Password Hashing Tests
 */
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

describe('Password — hashPassword', () => {
  it('returns scrypt-prefixed hash', () => {
    const h = hashPassword('MyS3cret!')
    expect(h.startsWith('scrypt$')).toBe(true)
  })

  it('produces 3-part format: scrypt$salt$hash', () => {
    const h = hashPassword('test')
    const parts = h.split('$')
    expect(parts.length).toBe(3)
    expect(parts[0]).toBe('scrypt')
    expect(parts[1].length).toBe(32) // 16 bytes hex
    expect(parts[2].length).toBe(128) // 64 bytes hex
  })

  it('generates unique salts per call', () => {
    const h1 = hashPassword('same')
    const h2 = hashPassword('same')
    expect(h1).not.toBe(h2)
    // Same password, different salts → different hashes
    const s1 = h1.split('$')[1]
    const s2 = h2.split('$')[1]
    expect(s1).not.toBe(s2)
  })
})

describe('Password — verifyPassword', () => {
  it('verifies correct password', () => {
    const h = hashPassword('correct-horse-battery-staple')
    expect(verifyPassword('correct-horse-battery-staple', h)).toBe(true)
  })

  it('rejects incorrect password', () => {
    const h = hashPassword('password123')
    expect(verifyPassword('password124', h)).toBe(false)
  })

  it('rejects empty password', () => {
    const h = hashPassword('something')
    expect(verifyPassword('', h)).toBe(false)
  })

  it('rejects malformed stored hash (missing parts)', () => {
    expect(verifyPassword('x', 'scrypt$abc')).toBe(false)
    expect(verifyPassword('x', 'bcrypt$salt$hash')).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
  })

  it('handles unicode passwords', () => {
    const h = hashPassword('รหัสผ่าน🔐')
    expect(verifyPassword('รหัสผ่าน🔐', h)).toBe(true)
    expect(verifyPassword('รหัสผ่าน🔑', h)).toBe(false)
  })

  it('is timing-safe (does not throw on length mismatch)', () => {
    // Corrupted hash length shouldn't throw
    expect(verifyPassword('x', 'scrypt$aabb$cc')).toBe(false)
  })
})
