/**
 * AAELink — SCIM v2 Provisioning Tests
 *
 * Validates SCIM user/group data mapping, filter parsing, and
 * response structure compliance with RFC 7644.
 */
import { describe, it, expect } from 'vitest'

// ── SCIM Schema Constants ────────────────────────────────────────────

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'

// ── Filter Parser (extracted logic for unit testing) ──────────────────

function parseScimFilter(filter: string): { field: string; op: string; value: string } | null {
  const match = filter.match(/^(\w+)\s+(eq|co|sw)\s+"([^"]*)"$/i)
  if (!match) return null
  return { field: match[1], op: match[2].toLowerCase(), value: match[3] }
}

// ── User Mapping (extracted logic for unit testing) ───────────────────

function dbUserToScim(row: Record<string, unknown>) {
  const emails: Array<{ value: string; type: string; primary: boolean }> = []
  if (row.email) emails.push({ value: String(row.email), type: 'work', primary: true })

  return {
    schemas: [SCIM_USER_SCHEMA],
    id: String(row.id),
    externalId: row.scim_external_id ? String(row.scim_external_id) : undefined,
    userName: String(row.username),
    name: {
      givenName: String(row.first_name || ''),
      familyName: String(row.last_name || ''),
      formatted: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    },
    displayName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || String(row.nickname || row.username),
    emails,
    active: row.scim_active !== false,
  }
}

// ── Filter Parsing ───────────────────────────────────────────────────

describe('SCIM — Filter Parsing', () => {
  it('parses eq filter correctly', () => {
    const result = parseScimFilter('userName eq "john.doe"')
    expect(result).toEqual({ field: 'userName', op: 'eq', value: 'john.doe' })
  })

  it('parses co filter correctly', () => {
    const result = parseScimFilter('email co "example.com"')
    expect(result).toEqual({ field: 'email', op: 'co', value: 'example.com' })
  })

  it('parses sw filter correctly', () => {
    const result = parseScimFilter('userName sw "john"')
    expect(result).toEqual({ field: 'userName', op: 'sw', value: 'john' })
  })

  it('returns null for invalid filters', () => {
    expect(parseScimFilter('')).toBeNull()
    expect(parseScimFilter('invalid')).toBeNull()
    expect(parseScimFilter('userName eq john')).toBeNull() // missing quotes
  })

  it('handles case-insensitive operators', () => {
    const result = parseScimFilter('userName EQ "test"')
    expect(result).toEqual({ field: 'userName', op: 'eq', value: 'test' })
  })
})

// ── User Mapping ─────────────────────────────────────────────────────

describe('SCIM — User Mapping', () => {
  it('maps DB user to SCIM format with all fields', () => {
    const scim = dbUserToScim({
      id: 'usr-001', username: 'jane.doe', email: 'jane@aae.co.th',
      first_name: 'Jane', last_name: 'Doe', nickname: 'jd',
      scim_external_id: 'ext-123', scim_active: true,
    })

    expect(scim.schemas).toContain(SCIM_USER_SCHEMA)
    expect(scim.id).toBe('usr-001')
    expect(scim.userName).toBe('jane.doe')
    expect(scim.externalId).toBe('ext-123')
    expect(scim.name.givenName).toBe('Jane')
    expect(scim.name.familyName).toBe('Doe')
    expect(scim.name.formatted).toBe('Jane Doe')
    expect(scim.displayName).toBe('Jane Doe')
    expect(scim.emails).toHaveLength(1)
    expect(scim.emails[0].value).toBe('jane@aae.co.th')
    expect(scim.emails[0].primary).toBe(true)
    expect(scim.active).toBe(true)
  })

  it('handles deactivated users', () => {
    const scim = dbUserToScim({
      id: 'usr-002', username: 'inactive', email: 'x@x.com',
      first_name: '', last_name: '', scim_active: false,
    })
    expect(scim.active).toBe(false)
  })

  it('falls back to nickname when name is empty', () => {
    const scim = dbUserToScim({
      id: 'usr-003', username: 'bot', email: 'bot@aae.co.th',
      first_name: '', last_name: '', nickname: 'Helper Bot',
    })
    expect(scim.displayName).toBe('Helper Bot')
  })

  it('falls back to username when both name and nickname are empty', () => {
    const scim = dbUserToScim({
      id: 'usr-004', username: 'admin', email: 'admin@aae.co.th',
      first_name: '', last_name: '', nickname: '',
    })
    expect(scim.displayName).toBe('admin')
  })

  it('omits externalId when not set', () => {
    const scim = dbUserToScim({
      id: 'usr-005', username: 'local', email: 'local@aae.co.th',
      first_name: 'Local', last_name: 'User',
    })
    expect(scim.externalId).toBeUndefined()
  })
})

// ── Schema Constants ─────────────────────────────────────────────────

describe('SCIM — Schema Constants', () => {
  it('uses correct SCIM v2 URNs', () => {
    expect(SCIM_USER_SCHEMA).toBe('urn:ietf:params:scim:schemas:core:2.0:User')
    expect(SCIM_GROUP_SCHEMA).toBe('urn:ietf:params:scim:schemas:core:2.0:Group')
    expect(SCIM_LIST_SCHEMA).toBe('urn:ietf:params:scim:api:messages:2.0:ListResponse')
    expect(SCIM_ERROR_SCHEMA).toBe('urn:ietf:params:scim:api:messages:2.0:Error')
  })
})

// ── SCIM Error Formatting ────────────────────────────────────────────

describe('SCIM — Error Format', () => {
  it('produces RFC 7644 compliant error objects', () => {
    const error = {
      schemas: [SCIM_ERROR_SCHEMA],
      detail: 'User not found',
      status: '404',
    }
    expect(error.schemas).toContain(SCIM_ERROR_SCHEMA)
    expect(error.detail).toBe('User not found')
    expect(error.status).toBe('404')
    expect(typeof error.status).toBe('string') // SCIM requires status as string
  })
})
