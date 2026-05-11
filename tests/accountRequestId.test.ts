/**
 * AAELink — Account Request ID Tests
 */
import { describe, it, expect } from 'vitest'
import { newAccountRequestId } from '@/lib/accountRequestId'

describe('AccountRequestId', () => {
  it('returns 12-char hex string', () => {
    const id = newAccountRequestId()
    expect(id.length).toBe(12)
    expect(/^[0-9a-f]{12}$/.test(id)).toBe(true)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newAccountRequestId()))
    expect(ids.size).toBe(50)
  })
})
