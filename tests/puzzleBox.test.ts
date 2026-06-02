/**
 * Puzzle Box — extractor + router + normalize behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractByRegex } from '@/lib/documents/puzzleBox/extract/regex'
import { routeExtraction } from '@/lib/documents/puzzleBox/extract/router'
import { runNormalize } from '@/lib/documents/puzzleBox/normalize'
import type { PuzzlePiece } from '@/lib/documents/puzzleBox/types'

const INVOICE = `
ACME Co.
Invoice #: INV-2026-001
Date: 2026-04-15
Due Date: 2026-05-15
Subtotal: $1,234.56
Tax: $86.42
Total: $1,320.98
`

describe('extractByRegex', () => {
  it('captures invoice fields', () => {
    const p = extractByRegex(INVOICE, 'src-1')
    expect(p.document_kind).toBe('invoice')
    expect(p.fields.invoice_number).toBe('INV-2026-001')
    expect(p.fields.due_date).toBe('2026-05-15')
    expect(p.fields.total).toBeCloseTo(1320.98)
    expect(p.extraction.method).toBe('regex')
  })

  it('marks empty when no patterns match', () => {
    const p = extractByRegex('lorem ipsum', 'src-2')
    expect(p.extraction.warnings).toContain('no_patterns_matched')
  })
})

describe('routeExtraction', () => {
  beforeEach(() => { delete process.env.AI_GATEWAY_URL })
  afterEach(() => { delete process.env.AI_GATEWAY_URL })

  it('forces regex when strategy=regex', async () => {
    const p = await routeExtraction(INVOICE, 'src', { workspace_id: 'w', strategy: 'regex' })
    expect(p.extraction.method).toBe('regex')
  })

  it('falls back to regex when LLM gateway absent in auto mode', async () => {
    const p = await routeExtraction(INVOICE, 'src', { workspace_id: 'w', strategy: 'auto' })
    expect(p.extraction.method).toBe('regex')
  })
})

describe('runNormalize — coercion', () => {
  const piece: PuzzlePiece = {
    schema_version: '1',
    source: { kind: 'upload', ref: 'r' },
    customer_id: '',
    document_kind: 'invoice',
    fields: {
      due_date: '4/15/2026',
      total: '1,234.56',
      tax: '$86.42',
      reference: 'plain',
    },
    line_items: [{ qty: '2', unit_price: '99.50' }],
    extraction: { method: 'regex', confidence: 0.6, warnings: [] },
  }

  it('coerces date and numeric fields', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Parameters<typeof runNormalize>[0]['pool']
    const out = await runNormalize({ workspace_id: 'w', piece, pool })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.fields.due_date).toBe('2026-04-15')
    expect(out.value.fields.total).toBeCloseTo(1234.56)
    expect(out.value.fields.tax).toBeCloseTo(86.42)
    expect(out.value.line_items?.[0].qty).toBe(2)
    expect(out.value.line_items?.[0].unit_price).toBeCloseTo(99.5)
  })

  it('resolves customer when client_profile_id supplied', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Parameters<typeof runNormalize>[0]['pool']
    const out = await runNormalize({ workspace_id: 'w', piece, client_profile_id: 'c123', pool })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.customer_id).toBe('c123')
  })

  it('flags customer_unresolved when no hints', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Parameters<typeof runNormalize>[0]['pool']
    const noHint: PuzzlePiece = { ...piece, fields: { total: 1 } }
    const out = await runNormalize({ workspace_id: 'w', piece: noHint, pool })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.extraction.warnings).toContain('customer_unresolved')
  })
})
