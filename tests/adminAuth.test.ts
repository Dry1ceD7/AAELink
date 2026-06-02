/**
 * AAELink — Admin Auth Type Tests
 */
import { describe, it, expect } from 'vitest'
import type { AdminSession } from '@/lib/auth/adminAuth'

describe('AdminAuth — AdminSession type', () => {
  it('accepts valid admin session', () => {
    const session: AdminSession = {
      userId: 'u-admin-1',
      platformRole: 'super_admin',
    }
    expect(session.userId).toBe('u-admin-1')
    expect(session.platformRole).toBe('super_admin')
  })

  it('accepts IT admin role', () => {
    const session: AdminSession = {
      userId: 'u-admin-2',
      platformRole: 'it_admin',
    }
    expect(session.platformRole).toBe('it_admin')
  })

  it('accepts IT employee role', () => {
    const session: AdminSession = {
      userId: 'u-admin-3',
      platformRole: 'it_employee',
    }
    expect(session.platformRole).toBe('it_employee')
  })
})
