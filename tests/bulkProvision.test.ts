/**
 * AAELink — Bulk User Provisioning Tests
 */
import { describe, it, expect } from 'vitest'
import {
  BulkProvisionEngine,
  parseCsv,
  validateRecord,
  type BulkUserRecord,
} from '@/lib/enterprise/bulkProvision'

// ── CSV Parsing ──────────────────────────────────────────────────────

describe('Bulk Provision — CSV Parsing', () => {
  it('parses standard CSV', () => {
    const csv = `username,email,first_name,last_name
john.doe,john@example.com,John,Doe
jane.doe,jane@example.com,Jane,Doe`

    const records = parseCsv(csv)
    expect(records).toHaveLength(2)
    expect(records[0].username).toBe('john.doe')
    expect(records[0].email).toBe('john@example.com')
    expect(records[1].first_name).toBe('Jane')
  })

  it('handles quoted fields with commas', () => {
    const csv = `username,email,job_title
admin,"admin@test.com","Senior Developer, Lead"`

    const records = parseCsv(csv)
    expect(records).toHaveLength(1)
    expect(records[0].job_title).toBe('Senior Developer, Lead')
  })

  it('maps alternative column names', () => {
    const csv = `user_name,email_address,firstname,lastname,dept
bob,bob@test.com,Bob,Builder,Engineering`

    const records = parseCsv(csv)
    expect(records[0].username).toBe('bob')
    expect(records[0].first_name).toBe('Bob')
    expect(records[0].department).toBe('Engineering')
  })

  it('returns empty for invalid CSV', () => {
    expect(parseCsv('')).toHaveLength(0)
    expect(parseCsv('just_header')).toHaveLength(0)
  })
})

// ── Validation ───────────────────────────────────────────────────────

describe('Bulk Provision — Validation', () => {
  it('validates good records', () => {
    expect(validateRecord({ username: 'john', email: 'john@test.com' }, 1)).toBeNull()
  })

  it('rejects empty username', () => {
    expect(validateRecord({ username: '', email: 'a@b.com' }, 1)).toContain('invalid username')
  })

  it('rejects invalid email', () => {
    expect(validateRecord({ username: 'john', email: 'notanemail' }, 1)).toContain('invalid email')
  })

  it('rejects invalid role', () => {
    expect(validateRecord({ username: 'john', email: 'a@b.com', platform_role: 'superadmin' }, 1)).toContain('invalid platform_role')
  })

  it('accepts valid roles', () => {
    expect(validateRecord({ username: 'john', email: 'a@b.com', platform_role: 'admin' }, 1)).toBeNull()
    expect(validateRecord({ username: 'john', email: 'a@b.com', platform_role: 'member' }, 1)).toBeNull()
    expect(validateRecord({ username: 'john', email: 'a@b.com', platform_role: 'guest' }, 1)).toBeNull()
  })
})

// ── Preview ──────────────────────────────────────────────────────────

describe('Bulk Provision — Preview', () => {
  it('validates all records without side effects', () => {
    const engine = new BulkProvisionEngine()
    const result = engine.preview([
      { username: 'good_user', email: 'good@test.com' },
      { username: '', email: 'bad@test.com' },
    ])

    expect(result.preview).toBe(true)
    expect(result.total_rows).toBe(2)
    expect(result.created).toBe(1)
    expect(result.errors).toBe(1)
    expect(result.rows[1].status).toBe('error')
  })
})

// ── Execute ──────────────────────────────────────────────────────────

describe('Bulk Provision — Execute', () => {
  it('creates new users', async () => {
    const created: BulkUserRecord[] = []
    const engine = new BulkProvisionEngine()

    const result = await engine.execute(
      [{ username: 'newuser', email: 'new@test.com', first_name: 'New' }],
      async () => null, // no existing user
      async (rec) => { created.push(rec) },
      async () => {},
    )

    expect(result.created).toBe(1)
    expect(created).toHaveLength(1)
    expect(created[0].username).toBe('newuser')
  })

  it('skips existing users with skip strategy', async () => {
    const engine = new BulkProvisionEngine({ conflict_strategy: 'skip' })

    const result = await engine.execute(
      [{ username: 'existing', email: 'existing@test.com' }],
      async () => 'user-123', // exists
      async () => {},
      async () => {},
    )

    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
  })

  it('overwrites existing users with overwrite strategy', async () => {
    const updated: string[] = []
    const engine = new BulkProvisionEngine({ conflict_strategy: 'overwrite' })

    const result = await engine.execute(
      [{ username: 'existing', email: 'existing@test.com', first_name: 'Updated' }],
      async () => 'user-123',
      async () => {},
      async (id) => { updated.push(id) },
    )

    expect(result.updated).toBe(1)
    expect(updated).toContain('user-123')
  })

  it('merges existing users with merge strategy', async () => {
    const updates: Array<{ id: string; rec: Partial<BulkUserRecord> }> = []
    const engine = new BulkProvisionEngine({ conflict_strategy: 'merge' })

    const result = await engine.execute(
      [{ username: 'existing', email: 'existing@test.com', job_title: 'CEO' }],
      async () => 'user-456',
      async () => {},
      async (id, rec) => { updates.push({ id, rec }) },
    )

    expect(result.updated).toBe(1)
    expect(updates[0].rec.job_title).toBe('CEO')
  })

  it('handles create errors gracefully', async () => {
    const engine = new BulkProvisionEngine()

    const result = await engine.execute(
      [{ username: 'fail_user', email: 'fail@test.com' }],
      async () => null,
      async () => { throw new Error('db_error') },
      async () => {},
    )

    expect(result.errors).toBe(1)
    expect(result.rows[0].error).toContain('db_error')
  })

  it('processes batches correctly', async () => {
    const engine = new BulkProvisionEngine({ batch_size: 2 })
    const created: string[] = []

    const records: BulkUserRecord[] = Array.from({ length: 5 }, (_, i) => ({
      username: `user_${i}`,
      email: `user_${i}@test.com`,
    }))

    const result = await engine.execute(
      records,
      async () => null,
      async (rec) => { created.push(rec.username) },
      async () => {},
    )

    expect(result.created).toBe(5)
    expect(created).toHaveLength(5)
  })
})

// ── CSRF ─────────────────────────────────────────────────────────────

describe('Bulk Provision — CSRF & Edge Cases', () => {
  it('normalizes usernames to lowercase', async () => {
    const created: BulkUserRecord[] = []
    const engine = new BulkProvisionEngine()

    await engine.execute(
      [{ username: 'TestUser', email: 'Test@Example.com' }],
      async () => null,
      async (rec) => { created.push(rec) },
      async () => {},
    )

    expect(created[0].username).toBe('testuser')
    expect(created[0].email).toBe('test@example.com')
  })
})
