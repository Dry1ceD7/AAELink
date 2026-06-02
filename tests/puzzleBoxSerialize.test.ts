/**
 * Block tree → HTML serializer.
 */

import { describe, it, expect } from 'vitest'
import { serializeDocument } from '@/lib/documents/puzzleBox/serialize'
import { BLOCK_LIBRARY, emptyDocument, slot, type DocumentTree } from '@/lib/documents/puzzleBox/blocks'
import type { ResolveContext } from '@/lib/documents/puzzleBox/resolve'
import type { PuzzlePiece } from '@/lib/documents/puzzleBox/types'

const piece: PuzzlePiece = {
  schema_version: '1',
  source: { kind: 'manual', ref: '' },
  customer_id: 'c1',
  document_kind: 'invoice',
  fields: { invoice_number: 'INV-001', currency: 'USD' },
  line_items: [
    { description: 'Wire harness', qty: 7500, unit_price: 3.28, amount: 24600 },
  ],
  extraction: { method: 'manual', confidence: 1, warnings: [] },
}

const ctx: ResolveContext = {
  workspace: { name: 'AAE' },
  client: { id: 'c1', workspace_id: 'w1', code: '', name: 'United Marketing', logo_bucket_key: 'logos/c1.png',
    brand: {}, address: { line1: 'Olympia Plaza' }, tax_id: '', phone: '', email: '', website: '',
    legal_boilerplate: '', metadata: {} },
  user: null, ticket: null, assembly: piece,
}

const resolveImage = (key: string) => key ? `https://cdn/${key}` : ''

function buildDoc(): DocumentTree {
  const doc = emptyDocument('A4')
  const logo = BLOCK_LIBRARY.logo.factory('logo-1', { page: 1, x_mm: 10, y_mm: 10, w_mm: 60, h_mm: 25 })
  const recipient = BLOCK_LIBRARY.recipient.factory('rec-1', { page: 1, x_mm: 10, y_mm: 50, w_mm: 90, h_mm: 35 })
  const items = BLOCK_LIBRARY.line_items.factory('rows-1', { page: 1, x_mm: 10, y_mm: 100, w_mm: 190, h_mm: 80 })
  const totals = BLOCK_LIBRARY.totals.factory('tot-1', { page: 1, x_mm: 110, y_mm: 200, w_mm: 90, h_mm: 30 })
  const note = BLOCK_LIBRARY.note.factory('note-1', { page: 1, x_mm: 10, y_mm: 250, w_mm: 190, h_mm: 12 })
  doc.blocks[logo.id] = logo
  doc.blocks[recipient.id] = recipient
  doc.blocks[items.id] = items
  doc.blocks[totals.id] = totals
  doc.blocks[note.id] = note
  doc.pages[0].block_ids.push(logo.id, recipient.id, items.id, totals.id, note.id)
  return doc
}

describe('serializeDocument — structure', () => {
  it('emits one .bx-page per page', () => {
    const doc = buildDoc()
    const html = serializeDocument(doc, { ctx, resolveImage })
    expect(html).toMatch(/<section class="bx-page"/)
    // A4 in mm
    expect(html).toMatch(/width:210mm/)
    expect(html).toMatch(/height:297mm/)
  })

  it('emits a div for every block with the right type marker', () => {
    const html = serializeDocument(buildDoc(), { ctx, resolveImage })
    expect(html).toMatch(/bx-block bx-block--logo/)
    expect(html).toMatch(/bx-block bx-block--recipient/)
    expect(html).toMatch(/bx-block bx-block--line_items/)
    expect(html).toMatch(/bx-block bx-block--totals/)
    expect(html).toMatch(/bx-block bx-block--note/)
  })
})

describe('serializeDocument — content', () => {
  it('substitutes the client name into the recipient block', () => {
    const html = serializeDocument(buildDoc(), { ctx, resolveImage })
    expect(html).toContain('United Marketing')
  })

  it('substitutes the logo image src via the resolver', () => {
    const html = serializeDocument(buildDoc(), { ctx, resolveImage })
    expect(html).toContain('https://cdn/logos/c1.png')
  })

  it('renders the line_items table with formatted currency', () => {
    const html = serializeDocument(buildDoc(), { ctx, resolveImage })
    // unit_price 3.28 → "3.28" with 2 decimals; amount 24600 → "24,600.00"
    expect(html).toContain('3.28')
    expect(html).toContain('24,600.00')
  })

  it('totals row includes the sum and currency suffix', () => {
    const html = serializeDocument(buildDoc(), { ctx, resolveImage })
    // formula sum -> "24600" then transform 'currency' makes it "24,600.00 USD"
    expect(html).toMatch(/24,600\.00\s+USD/)
  })

  it('escapes HTML in user-supplied content', () => {
    const doc = buildDoc()
    // mutate the recipient name slot through context (simulate hostile client name)
    const evil = { ...ctx, client: { ...ctx.client!, name: '<script>alert(1)</script>' } }
    const html = serializeDocument(doc, { ctx: evil, resolveImage })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('serializeDocument — overrides + watermark', () => {
  it('per-document override replaces a slot value', () => {
    const doc = buildDoc()
    const note = doc.blocks['note-1']
    if (note.type !== 'note') throw new Error('expected note')
    note.inputs.body = slot.manual('Original note')
    const overridden = { ...ctx, overrides: { 'note-1.body': slot.manual('Override note') } }
    const html = serializeDocument(doc, { ctx: overridden, resolveImage })
    expect(html).toContain('Override note')
    expect(html).not.toContain('Original note')
  })

  it('renders a watermark when supplied', () => {
    const html = serializeDocument(buildDoc(), { ctx, resolveImage, watermark: 'STAGING' })
    expect(html).toContain('STAGING')
    expect(html).toContain('bx-watermark')
  })
})
