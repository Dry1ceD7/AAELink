/**
 * AAELink — Platform Role Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { isPlatformAdmin, isSuperAdmin, isItAdmin } from '@/lib/comms/platformRole'

// ── isSuperAdmin ────────────────────────────────────────────────────

describe('PlatformRole — isSuperAdmin', () => {
  it('true for "super_admin"', () => {
    expect(isSuperAdmin('super_admin')).toBe(true)
  })

  it('false for "it_admin"', () => {
    expect(isSuperAdmin('it_admin')).toBe(false)
  })

  it('false for "it_employee"', () => {
    expect(isSuperAdmin('it_employee')).toBe(false)
  })

  it('false for "employee"', () => {
    expect(isSuperAdmin('employee')).toBe(false)
  })

  it('false for empty string', () => {
    expect(isSuperAdmin('')).toBe(false)
  })

  it('false for null', () => {
    expect(isSuperAdmin(null)).toBe(false)
  })

  it('false for undefined', () => {
    expect(isSuperAdmin(undefined)).toBe(false)
  })

  it('false for unrecognized role', () => {
    expect(isSuperAdmin('admin')).toBe(false)
    expect(isSuperAdmin('root')).toBe(false)
    expect(isSuperAdmin('platform_admin')).toBe(false)
  })
})

// ── isItAdmin ───────────────────────────────────────────────────────

describe('PlatformRole — isItAdmin', () => {
  it('true for "it_admin"', () => {
    expect(isItAdmin('it_admin')).toBe(true)
  })

  it('false for "super_admin"', () => {
    expect(isItAdmin('super_admin')).toBe(false)
  })

  it('false for "it_employee"', () => {
    expect(isItAdmin('it_employee')).toBe(false)
  })

  it('false for "employee"', () => {
    expect(isItAdmin('employee')).toBe(false)
  })

  it('false for empty string', () => {
    expect(isItAdmin('')).toBe(false)
  })

  it('false for null', () => {
    expect(isItAdmin(null)).toBe(false)
  })

  it('false for undefined', () => {
    expect(isItAdmin(undefined)).toBe(false)
  })
})

// ── isPlatformAdmin ─────────────────────────────────────────────────

describe('PlatformRole — isPlatformAdmin', () => {
  it('true for "super_admin"', () => {
    expect(isPlatformAdmin('super_admin')).toBe(true)
  })

  it('true for "it_admin"', () => {
    expect(isPlatformAdmin('it_admin')).toBe(true)
  })

  it('false for "it_employee" (not admin tier)', () => {
    expect(isPlatformAdmin('it_employee')).toBe(false)
  })

  it('false for "employee"', () => {
    expect(isPlatformAdmin('employee')).toBe(false)
  })

  it('false for empty string', () => {
    expect(isPlatformAdmin('')).toBe(false)
  })

  it('false for null', () => {
    expect(isPlatformAdmin(null as unknown as string)).toBe(false)
  })

  it('false for undefined', () => {
    expect(isPlatformAdmin(undefined)).toBe(false)
  })

  it('false for unrecognized roles', () => {
    expect(isPlatformAdmin('platform_admin')).toBe(false)
    expect(isPlatformAdmin('admin')).toBe(false)
    expect(isPlatformAdmin('manager')).toBe(false)
  })
})

// ── Role hierarchy invariants ───────────────────────────────────────

describe('PlatformRole — hierarchy invariants', () => {
  it('super_admin is always a platform admin', () => {
    expect(isPlatformAdmin('super_admin')).toBe(true)
    expect(isSuperAdmin('super_admin')).toBe(true)
  })

  it('it_admin is platform admin but NOT super admin', () => {
    expect(isPlatformAdmin('it_admin')).toBe(true)
    expect(isSuperAdmin('it_admin')).toBe(false)
  })

  it('it_employee is neither', () => {
    expect(isPlatformAdmin('it_employee')).toBe(false)
    expect(isSuperAdmin('it_employee')).toBe(false)
    expect(isItAdmin('it_employee')).toBe(false)
  })

  it('employee is neither', () => {
    expect(isPlatformAdmin('employee')).toBe(false)
    expect(isSuperAdmin('employee')).toBe(false)
    expect(isItAdmin('employee')).toBe(false)
  })
})
