/**
 * AAELink — Template Engine Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import {
  resolveTemplate, extractPlaceholders, buildFullAddress,
  batchFindReplace, validatePlaceholders, contextFromClientProfile,
  type TemplateContext,
} from '@/lib/templateEngine'

// ── resolveTemplate ──────────────────────────────────────────────────

describe('TemplateEngine — resolveTemplate — basic', () => {
  it('replaces simple placeholders', () => {
    expect(resolveTemplate('Hello {{client.name}}!', { client: { name: 'Acme' } })).toBe('Hello Acme!')
  })
  it('resolves nested dot paths', () => {
    const r = resolveTemplate('{{client.city}}, {{client.country}}', {
      client: { city: 'Bangkok', country: 'Thailand' },
    })
    expect(r).toBe('Bangkok, Thailand')
  })
  it('preserves unresolved placeholders', () => {
    expect(resolveTemplate('{{missing}}', {})).toBe('{{missing}}')
  })
  it('replaces multiple occurrences', () => {
    expect(resolveTemplate('{{client.name}} is {{client.name}}', { client: { name: 'X' } })).toBe('X is X')
  })
  it('handles empty context', () => {
    expect(resolveTemplate('no placeholders here', {})).toBe('no placeholders here')
  })
  it('handles empty string template', () => {
    expect(resolveTemplate('', { client: { name: 'X' } })).toBe('')
  })
  it('resolves user context', () => {
    expect(resolveTemplate('Hello {{user.first_name}}', { user: { first_name: 'John' } })).toBe('Hello John')
  })
  it('resolves ticket context', () => {
    expect(resolveTemplate('Ticket: {{ticket.title}}', { ticket: { title: 'Bug fix' } })).toBe('Ticket: Bug fix')
  })
  it('resolves custom variables', () => {
    expect(resolveTemplate('Ref: {{custom.ref_number}}', { custom: { ref_number: 'INV-001' } })).toBe('Ref: INV-001')
  })
})

// ── Transforms ──────────────────────────────────────────────────────

describe('TemplateEngine — resolveTemplate — transforms', () => {
  it('upper', () => {
    expect(resolveTemplate('{{upper:client.name}}', { client: { name: 'test' } })).toBe('TEST')
  })
  it('lower', () => {
    expect(resolveTemplate('{{lower:client.name}}', { client: { name: 'TEST' } })).toBe('test')
  })
  it('title', () => {
    expect(resolveTemplate('{{title:client.name}}', { client: { name: 'john doe' } })).toBe('John Doe')
  })
  it('trim', () => {
    expect(resolveTemplate('{{trim:client.name}}', { client: { name: '  spaced  ' } })).toBe('spaced')
  })
  it('currency (USD)', () => {
    const result = resolveTemplate('{{currency:custom.amount}}', { custom: { amount: 1234.56 } })
    expect(result).toContain('1,234.56')
  })
  it('currency with non-numeric returns original', () => {
    expect(resolveTemplate('{{currency:client.name}}', { client: { name: 'abc' } })).toBe('abc')
  })
  it('number formatting', () => {
    const result = resolveTemplate('{{number:custom.count}}', { custom: { count: 1000000 } })
    expect(result).toContain('1,000,000')
  })
  it('number with non-numeric returns original', () => {
    expect(resolveTemplate('{{number:client.name}}', { client: { name: 'notanum' } })).toBe('notanum')
  })
  it('preserves unresolved transform', () => {
    expect(resolveTemplate('{{upper:nonexistent.field}}', {})).toBe('{{upper:nonexistent.field}}')
  })
})

// ── Conditionals ──────────────────────────────────────────────────────

describe('TemplateEngine — resolveTemplate — conditionals', () => {
  it('renders body when truthy', () => {
    const r = resolveTemplate('{{#if client.name}}Present{{/if}}', { client: { name: 'X' } })
    expect(r).toBe('Present')
  })
  it('hides body when falsy (empty string)', () => {
    const r = resolveTemplate('{{#if client.name}}Present{{/if}}', { client: { name: '' } })
    expect(r).toBe('')
  })
  it('hides body when missing', () => {
    const r = resolveTemplate('{{#if client.phone}}Has phone{{/if}}', { client: { name: 'X' } })
    expect(r).toBe('')
  })
  it('hides body when value is "false"', () => {
    const r = resolveTemplate('{{#if custom.active}}Active{{/if}}', { custom: { active: false } })
    expect(r).toBe('')
  })
  it('hides body when value is "0"', () => {
    const r = resolveTemplate('{{#if custom.count}}Has count{{/if}}', { custom: { count: 0 } })
    expect(r).toBe('')
  })
  it('supports placeholders inside conditional body', () => {
    const r = resolveTemplate('{{#if client.name}}Name: {{client.name}}{{/if}}', { client: { name: 'Acme' } })
    expect(r).toBe('Name: Acme')
  })
})

// ── Loops ────────────────────────────────────────────────────────────

describe('TemplateEngine — resolveTemplate — loops', () => {
  it('iterates over JSON array with {{this}}', () => {
    const ctx: TemplateContext = { custom: { items: '["a","b","c"]' } }
    const r = resolveTemplate('{{#each custom.items}}[{{this}}]{{/each}}', ctx)
    expect(r).toBe('[a][b][c]')
  })
  it('supports {{@index}} and {{@number}}', () => {
    const ctx: TemplateContext = { custom: { items: '["x","y"]' } }
    const r = resolveTemplate('{{#each custom.items}}{{@number}}.{{this}} {{/each}}', ctx)
    expect(r).toBe('1.x 2.y ')
  })
  it('handles object items', () => {
    const ctx: TemplateContext = { custom: { people: '[{"name":"Alice"},{"name":"Bob"}]' } }
    const r = resolveTemplate('{{#each custom.people}}{{name}}, {{/each}}', ctx)
    expect(r).toBe('Alice, Bob, ')
  })
  it('returns empty for non-existent key', () => {
    const r = resolveTemplate('{{#each missing}}{{this}}{{/each}}', {})
    expect(r).toBe('')
  })
  it('returns empty for non-array JSON', () => {
    const ctx: TemplateContext = { custom: { obj: '{"key":"val"}' } }
    const r = resolveTemplate('{{#each custom.obj}}{{this}}{{/each}}', ctx)
    expect(r).toBe('')
  })
  it('returns empty for invalid JSON', () => {
    const ctx: TemplateContext = { custom: { bad: 'not json' } }
    const r = resolveTemplate('{{#each custom.bad}}{{this}}{{/each}}', ctx)
    expect(r).toBe('')
  })
})

// ── Date variables ──────────────────────────────────────────────────

describe('TemplateEngine — resolveTemplate — date variables', () => {
  it('resolves {{date.year}} to current year', () => {
    expect(resolveTemplate('{{date.year}}', {})).toBe(String(new Date().getFullYear()))
  })
  it('resolves {{date.iso}} to ISO date', () => {
    expect(resolveTemplate('{{date.iso}}', {})).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('resolves {{timestamp}} to numeric value', () => {
    const r = resolveTemplate('{{timestamp}}', {})
    expect(Number(r)).toBeGreaterThan(0)
  })
  it('resolves {{date}} to a formatted date', () => {
    const r = resolveTemplate('{{date}}', {})
    expect(r.length).toBeGreaterThan(5)
  })
  it('resolves {{time}} to a time string', () => {
    const r = resolveTemplate('{{time}}', {})
    expect(r).toMatch(/\d/)
  })
})

// ── extractPlaceholders ──────────────────────────────────────────────

describe('TemplateEngine — extractPlaceholders', () => {
  it('extracts simple keys', () => {
    const keys = extractPlaceholders('{{client.name}} and {{client.email}}')
    expect(keys).toContain('client.name')
    expect(keys).toContain('client.email')
    expect(keys).toHaveLength(2)
  })
  it('skips block markers (#if, /if)', () => {
    const keys = extractPlaceholders('{{#if x}}{{val}}{{/if}}')
    expect(keys).toContain('val')
    expect(keys).not.toContain('#if x')
    expect(keys).not.toContain('/if')
  })
  it('skips loop markers', () => {
    const keys = extractPlaceholders('{{#each items}}{{name}}{{/each}}')
    expect(keys).toContain('name')
    expect(keys).not.toContain('#each items')
  })
  it('extracts transform targets', () => {
    const keys = extractPlaceholders('{{upper:client.name}}')
    expect(keys).toContain('client.name')
  })
  it('extracts date format targets', () => {
    const keys = extractPlaceholders('{{date:YYYY-MM-DD:ticket.created}}')
    expect(keys).toContain('ticket.created')
  })
  it('deduplicates', () => {
    const keys = extractPlaceholders('{{client.name}} {{client.name}}')
    expect(keys).toHaveLength(1)
  })
  it('returns empty for no placeholders', () => {
    expect(extractPlaceholders('plain text')).toEqual([])
  })
})

// ── buildFullAddress ──────────────────────────────────────────────────

describe('TemplateEngine — buildFullAddress', () => {
  it('builds multi-line address', () => {
    const addr = buildFullAddress({
      name: 'X', address_line1: '123 Main', city: 'NYC', state: 'NY', postal_code: '10001', country: 'US',
    })
    expect(addr).toContain('123 Main')
    expect(addr).toContain('NYC, NY')
    expect(addr).toContain('10001')
    expect(addr).toContain('US')
  })
  it('skips empty fields', () => {
    const addr = buildFullAddress({ name: 'X', address_line1: '123 Main', country: 'US' })
    expect(addr).toBe('123 Main\nUS')
  })
  it('includes address_line2', () => {
    const addr = buildFullAddress({
      name: 'X', address_line1: 'Line 1', address_line2: 'Suite 5', country: 'US',
    })
    expect(addr).toContain('Suite 5')
  })
  it('returns empty for undefined', () => {
    expect(buildFullAddress(undefined)).toBe('')
  })
})

// ── batchFindReplace ──────────────────────────────────────────────────

describe('TemplateEngine — batchFindReplace', () => {
  it('replaces simple text', () => {
    expect(batchFindReplace('hello world', [{ find: 'world', replace: 'earth' }])).toBe('hello earth')
  })
  it('case insensitive by default', () => {
    expect(batchFindReplace('Hello HELLO hello', [{ find: 'hello', replace: 'hi' }])).toBe('hi hi hi')
  })
  it('case sensitive when set', () => {
    expect(batchFindReplace('Hello HELLO hello', [{ find: 'Hello', replace: 'hi', case_sensitive: true }])).toBe('hi HELLO hello')
  })
  it('whole word matching', () => {
    expect(batchFindReplace('cat category', [{ find: 'cat', replace: 'dog', whole_word: true }])).toBe('dog category')
  })
  it('applies multiple rules in order', () => {
    const result = batchFindReplace('a b c', [
      { find: 'a', replace: 'x' },
      { find: 'b', replace: 'y' },
      { find: 'c', replace: 'z' },
    ])
    expect(result).toBe('x y z')
  })
  it('skips rules with empty find', () => {
    expect(batchFindReplace('hello', [{ find: '', replace: 'x' }])).toBe('hello')
  })
  it('handles regex special characters in find', () => {
    expect(batchFindReplace('price: $100.00', [{ find: '$100.00', replace: '$200.00' }])).toBe('price: $200.00')
  })
})

// ── validatePlaceholders ──────────────────────────────────────────────

describe('TemplateEngine — validatePlaceholders', () => {
  it('returns missing keys', () => {
    const missing = validatePlaceholders(['client.name', 'client.phone'], { client: { name: 'X' } })
    expect(missing).toContain('client.phone')
    expect(missing).not.toContain('client.name')
  })
  it('returns empty when all present', () => {
    const missing = validatePlaceholders(['client.name'], { client: { name: 'X' } })
    expect(missing).toEqual([])
  })
  it('skips date variables', () => {
    const missing = validatePlaceholders(['date.year', 'client.name'], { client: { name: 'X' } })
    expect(missing).toEqual([])
  })
  it('respects required list subset', () => {
    const missing = validatePlaceholders(
      ['client.name', 'client.phone', 'client.email'],
      { client: { name: 'X' } },
      ['client.phone']
    )
    expect(missing).toEqual(['client.phone'])
  })
})

// ── contextFromClientProfile ──────────────────────────────────────────

describe('TemplateEngine — contextFromClientProfile', () => {
  it('builds context from DB row', () => {
    const ctx = contextFromClientProfile({ name: 'Acme', email: 'a@b.com', city: 'BKK' })
    expect(ctx.client?.name).toBe('Acme')
    expect(ctx.client?.email).toBe('a@b.com')
    expect(ctx.client?.city).toBe('BKK')
  })
  it('creates flat client_ prefixed fields', () => {
    const ctx = contextFromClientProfile({ name: 'Acme', code: 'ACM', email: 'a@b.com', tax_id: 'TH123' })
    expect(ctx.client_name).toBe('Acme')
    expect(ctx.client_code).toBe('ACM')
    expect(ctx.client_email).toBe('a@b.com')
    expect(ctx.client_tax_id).toBe('TH123')
  })
  it('builds client_address from address fields', () => {
    const ctx = contextFromClientProfile({
      name: 'X', address_line1: '123 Main', city: 'NYC', country: 'US',
    })
    expect(ctx.client_address).toContain('123 Main')
    expect(ctx.client_address).toContain('NYC')
  })
  it('handles empty profile', () => {
    const ctx = contextFromClientProfile({})
    expect(ctx.client?.name).toBe('')
  })
  it('merges metadata into client context', () => {
    const ctx = contextFromClientProfile({
      name: 'X', metadata: { custom_field: 'value' },
    })
    expect(ctx.client?.custom_field).toBe('value')
  })
})
