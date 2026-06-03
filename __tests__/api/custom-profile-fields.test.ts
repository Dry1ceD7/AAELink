/**
 * Integration tests for D11 org custom profile fields.
 *
 * Exercises lib/enterprise/customProfileFields.ts against a live Postgres. Routes
 * (admin/org/[orgId]/profile-fields, profile-fields) are thin wrappers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import {
  defineField,
  removeField,
  listFields,
  setUserValue,
  getUserProfile,
  normalizeFieldKey,
} from '@/lib/enterprise/customProfileFields'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []
const orgIds: string[] = []

async function mkOrg(): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.organizations (id, name, domain) VALUES ($1, $2, $3)`,
    [id, `Org ${id.slice(0, 6)}`, `${id.slice(0, 8)}.example.test`]
  )
  orgIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  if (orgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.user_profile_values WHERE field_id IN (SELECT id FROM aaelink.org_profile_fields WHERE org_id = ANY($1))`, [orgIds])
    await ctx.pool.query(`DELETE FROM aaelink.org_profile_fields WHERE org_id = ANY($1)`, [orgIds])
    await ctx.pool.query(`DELETE FROM aaelink.organizations WHERE id = ANY($1)`, [orgIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('normalizeFieldKey', () => {
  it('lowercases and snake-cases', () => {
    expect(normalizeFieldKey('Start Date!')).toBe('start_date')
    expect(normalizeFieldKey('  Pronouns  ')).toBe('pronouns')
  })
})

describe('defineField', () => {
  it('rejects invalid key/label/type', async () => {
    const org = await mkOrg()
    expect((await defineField(ctx.pool, org, { key: '!!!', label: 'X' })).ok).toBe(false)
    expect((await defineField(ctx.pool, org, { key: 'k', label: '' })).ok).toBe(false)
    expect((await defineField(ctx.pool, org, { key: 'k', label: 'X', type: 'bogus' })).ok).toBe(false)
  })

  it('defines and updates by key (upsert)', async () => {
    const org = await mkOrg()
    const a = await defineField(ctx.pool, org, { key: 'Pronouns', label: 'Pronouns', type: 'select', options: ['she', 'he', 'they'] })
    expect(a.ok).toBe(true)
    if (a.ok) expect(a.field.field_key).toBe('pronouns')

    // Re-define same key updates, doesn't duplicate.
    await defineField(ctx.pool, org, { key: 'pronouns', label: 'Pronouns (updated)', type: 'select', options: ['she', 'he', 'they', 'xe'] })
    const fields = await listFields(ctx.pool, org)
    expect(fields.length).toBe(1)
    expect(fields[0].label).toBe('Pronouns (updated)')
    expect(fields[0].options).toEqual(['she', 'he', 'they', 'xe'])
  })
})

describe('setUserValue + getUserProfile', () => {
  it('validates select options and round-trips values', async () => {
    const org = await mkOrg()
    const fieldRes = await defineField(ctx.pool, org, { key: 'desk', label: 'Desk', type: 'text', position: 1 })
    const selRes = await defineField(ctx.pool, org, { key: 'team', label: 'Team', type: 'select', options: ['eng', 'ops'], position: 0 })
    if (!fieldRes.ok || !selRes.ok) throw new Error('setup failed')

    expect((await setUserValue(ctx.pool, org, user.id, fieldRes.field.id, 'Window seat')).ok).toBe(true)
    expect(await setUserValue(ctx.pool, org, user.id, selRes.field.id, 'marketing')).toEqual({ ok: false, code: 'invalid_option' })
    expect((await setUserValue(ctx.pool, org, user.id, selRes.field.id, 'eng')).ok).toBe(true)
    expect(await setUserValue(ctx.pool, org, user.id, 'ghost', 'x')).toEqual({ ok: false, code: 'field_not_found' })

    const profile = await getUserProfile(ctx.pool, org, user.id)
    // Ordered by position: team (0) then desk (1).
    expect(profile.map(p => p.field_key)).toEqual(['team', 'desk'])
    expect(profile.find(p => p.field_key === 'desk')?.value).toBe('Window seat')
    expect(profile.find(p => p.field_key === 'team')?.value).toBe('eng')
  })

  it('returns every field with empty value when unset', async () => {
    const org = await mkOrg()
    await defineField(ctx.pool, org, { key: 'bio', label: 'Bio', type: 'textarea' })
    const profile = await getUserProfile(ctx.pool, org, user.id)
    expect(profile.length).toBe(1)
    expect(profile[0].value).toBe('')
  })
})

describe('removeField', () => {
  it('removes a field and reports missing ones', async () => {
    const org = await mkOrg()
    const f = await defineField(ctx.pool, org, { key: 'temp', label: 'Temp' })
    if (!f.ok) throw new Error('setup failed')
    expect(await removeField(ctx.pool, org, f.field.id)).toBe(true)
    expect(await removeField(ctx.pool, org, f.field.id)).toBe(false)
    expect(await listFields(ctx.pool, org)).toEqual([])
  })
})
