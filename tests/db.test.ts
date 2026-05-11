/**
 * AAELink — DB Pool Tests
 */
import { describe, it, expect } from 'vitest'
import { getPool } from '@/lib/db'

describe('DB — getPool', () => {
  it('returns null when DATABASE_URL not set', () => {
    const orig = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    const pool = getPool()
    expect(pool).toBeNull()
    process.env.DATABASE_URL = orig
  })
})
