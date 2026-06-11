/**
 * Seed templates — the bundled "Order Confirmation" et al. should be valid
 * the moment they're inserted, render against a sample piece without
 * blocking issues, and their bindings should swap when the client changes.
 */

import { describe, it, expect } from 'vitest'
import { SEED_TEMPLATES, findSeedTemplateByKind } from '@/lib/documents/puzzleBox/seedTemplates'
import { validateDocument } from '@/lib/documents/puzzleBox/blocks'
import { findBoundSlots as findBoundSlotsR } from '@/lib/documents/puzzleBox/resolve'
import { serializeDocument } from '@/lib/documents/puzzleBox/serialize'
import type { ResolveContext } from '@/lib/documents/puzzleBox/resolve'
import type { PuzzlePiece } from '@/lib/documents/puzzleBox/types'

void SEED_TEMPLATES
void validateDocument

describe('SEED_TEMPLATES — Order Confirmation', () => {
  const seed = findSeedTemplateByKind('order_confirmation')!

  it('exists in the catalogue', () => {
    expect(seed).toBeTruthy()
    expect(seed.kind).toBe('order_confirmation')
    expect(seed.page_size).toBe('A4')
  })

  it('validates without blocking issues', () => {
    const issues = validateDocument(seed.block_tree)
    const blocking = issues.filter(i => i.code !== 'orphan_block' && i.code !== 'overflow')
    expect(blocking).toEqual([])
  })

  it('exposes every reference-doc block (logo, sender, recipient, delivery, meta, line items, totals, terms, signature)', () => {
    const types = new Set(Object.values(seed.block_tree.blocks).map(b => b.type))
    expect(types.has('logo')).toBe(true)
    expect(types.has('sender_header')).toBe(true)
    expect(types.has('recipient')).toBe(true)
    expect(types.has('delivery_address')).toBe(true)
    expect(types.has('order_meta')).toBe(true)
    expect(types.has('line_items')).toBe(true)
    expect(types.has('totals')).toBe(true)
    expect(types.has('terms')).toBe(true)
    expect(types.has('signature')).toBe(true)
  })

  it('binds the recipient + (optionally) delivery to the client so swap works', () => {
    const clientBound = findBoundSlotsR(seed.block_tree, 'client')
    const blockIdsBound = new Set(clientBound.map(k => k.split('.')[0]))
    expect(blockIdsBound.has('recipient-1')).toBe(true)
  })

  it('serialises against a sample piece without errors and contains client name', () => {
    const piece: PuzzlePiece = {
      schema_version: '1',
      source: { kind: 'manual', ref: '' },
      customer_id: 'c1',
      document_kind: 'invoice',
      fields: { invoice_number: 'S 22072', issue_date: '2026-01-22', currency: 'USD' },
      line_items: [
        { description: 'WIRE HARNESS', qty: 7500, unit_price: 3.28, amount: 24600 },
      ],
      extraction: { method: 'manual', confidence: 1, warnings: [] },
    }
    const ctx: ResolveContext = {
      workspace: { name: 'Advanced ID Asia Engineering Co., Ltd', address: '116 Moo 3', tax_id: '0505548005683', contact: '+66 53 387316-7', brand: {} },
      client: {
        id: 'c1', workspace_id: 'w1', code: 'UMT-001', name: 'United Marketing & Trading Ltd',
        logo_bucket_key: '', brand: {},
        address: { line1: 'Room 1906-19/F, Olympia Plaza' },
        tax_id: '', phone: '', email: 'jj@aae.co.th', website: '',
        legal_boilerplate: '', metadata: {},
      },
      user: null, ticket: null, assembly: piece,
    }
    const html = serializeDocument(seed.block_tree, {
      ctx,
      resolveImage: (k) => k ? `cdn://${k}` : '',
    })
    expect(html).toContain('S 22072')
    expect(html).toContain('United Marketing &amp; Trading Ltd')
    expect(html).toContain('WIRE HARNESS')
    // Sub-total formula collapses to "24,600.00"
    expect(html).toContain('24,600.00')
  })
})
