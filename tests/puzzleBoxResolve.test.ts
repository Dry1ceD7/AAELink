/**
 * Slot resolver — the brain of the swap-by-binding model.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveSlot, resolveBlockInputs, describeSlot, findBoundSlots,
  type ResolveContext,
} from '@/lib/documents/puzzleBox/resolve'
import { slot, BLOCK_LIBRARY, emptyDocument } from '@/lib/documents/puzzleBox/blocks'
import type { PuzzlePiece } from '@/lib/documents/puzzleBox/types'

const piece: PuzzlePiece = {
  schema_version: '1',
  source: { kind: 'manual', ref: '' },
  customer_id: 'c1',
  document_kind: 'invoice',
  fields: { invoice_number: 'INV-001', currency: 'USD', total: 1320.98 },
  line_items: [
    { description: 'Wire harness', qty: 7500, unit_price: 3.28, amount: 24600 },
  ],
  extraction: { method: 'manual', confidence: 1, warnings: [] },
}

const ctx: ResolveContext = {
  workspace: { name: 'AAE', address: 'Chiang Mai', tax_id: '0505548005683', contact: '+66 53 387316-7', brand: {} },
  client: {
    id: 'c1', workspace_id: 'w1', code: 'UMT-001', name: 'United Marketing & Trading Ltd',
    logo_bucket_key: 'logos/c1.png', brand: {},
    address: { line1: 'Room 1906-19/F, Olympia Plaza', line2: '255 Kings Road, North Point', city: 'Hong Kong', country: 'Hong Kong' },
    tax_id: '', phone: '', email: 'jj@aae.co.th', website: '',
    legal_boilerplate: 'Standard terms apply.', metadata: {},
  },
  user: null,
  ticket: null,
  assembly: piece,
}

describe('resolveSlot — basic sources', () => {
  it('manual returns the literal', () => {
    expect(resolveSlot(slot.manual('hello'), ctx)).toBe('hello')
  })
  it('client.* reads client_profile', () => {
    expect(resolveSlot(slot.client('name'), ctx)).toBe('United Marketing & Trading Ltd')
    expect(resolveSlot(slot.client('logo_bucket_key'), ctx)).toBe('logos/c1.png')
  })
  it('client nested address', () => {
    expect(resolveSlot(slot.client('address.line1'), ctx)).toBe('Room 1906-19/F, Olympia Plaza')
    expect(resolveSlot(slot.client('address.country'), ctx)).toBe('Hong Kong')
  })
  it('workspace.* reads workspace brand', () => {
    expect(resolveSlot(slot.workspace('name'), ctx)).toBe('AAE')
  })
  it('assembly.* reads PuzzlePiece', () => {
    expect(resolveSlot(slot.assembly('fields.invoice_number'), ctx)).toBe('INV-001')
    expect(resolveSlot(slot.assembly('fields.total'), ctx)).toBe('1320.98')
  })
  it('falls back when path resolves to empty', () => {
    expect(resolveSlot(slot.client('nonexistent', 'fallback'), ctx)).toBe('fallback')
  })
})

describe('resolveSlot — array indexing', () => {
  it('reads array indices', () => {
    expect(resolveSlot(slot.assembly('line_items[0].description'), ctx)).toBe('Wire harness')
    expect(resolveSlot(slot.assembly('line_items[0].qty'), ctx)).toBe('7500')
  })
})

describe('resolveSlot — formulas', () => {
  it('sums array fields', () => {
    expect(resolveSlot(slot.formula('sum:assembly.line_items[].amount'), ctx)).toBe('24600')
  })
  it('counts array length', () => {
    expect(resolveSlot(slot.formula('count:assembly.line_items'), ctx)).toBe('1')
  })
  it('falls back when formula has no data', () => {
    const empty: ResolveContext = { ...ctx, assembly: { ...piece, line_items: [] } }
    expect(resolveSlot(slot.formula('sum:assembly.line_items[].amount', '0'), empty)).toBe('0')
  })
})

describe('resolveSlot — overrides', () => {
  it('per-document override replaces the bound value', () => {
    const overridden: ResolveContext = {
      ...ctx,
      overrides: { 'terms-1.body': slot.manual('60 day, manual override') },
    }
    const result = resolveSlot(slot.client('legal_boilerplate'), overridden, 'terms-1.body')
    expect(result).toBe('60 day, manual override')
  })

  it('override that points back to the same key does not loop', () => {
    const overridden: ResolveContext = {
      ...ctx,
      overrides: { 'k.input': slot.client('name') },
    }
    expect(resolveSlot(slot.manual('original'), overridden, 'k.input')).toBe('United Marketing & Trading Ltd')
  })
})

describe('resolveBlockInputs', () => {
  it('resolves every slot inside a logo block', () => {
    const block = BLOCK_LIBRARY.logo.factory('logo-1', { page: 1, x_mm: 10, y_mm: 10, w_mm: 60, h_mm: 25 })
    const out = resolveBlockInputs(block, ctx)
    expect(out.image).toBe('logos/c1.png')
    expect(out.caption).toBe('United Marketing & Trading Ltd')
  })

  it('totals block resolves formula rows', () => {
    const block = BLOCK_LIBRARY.totals.factory('tot-1', { page: 1, x_mm: 100, y_mm: 200, w_mm: 90, h_mm: 30 })
    const out = resolveBlockInputs(block, ctx)
    const rows = out.rows as Array<Record<string, unknown>>
    const totalRow = rows.find(r => (r as { key: string }).key === 'total')
    // Formula returns a number directly so renderers can format it; resolveSlot
    // (the string convenience) returns "24600". Both are valid contracts.
    expect(totalRow?.value).toBe(24600)
  })
})

describe('findBoundSlots', () => {
  it('returns every slot key bound to a given source', () => {
    const doc = emptyDocument('A4')
    const logo = BLOCK_LIBRARY.logo.factory('logo-1', { page: 1, x_mm: 10, y_mm: 10, w_mm: 60, h_mm: 25 })
    const recipient = BLOCK_LIBRARY.recipient.factory('rec-1', { page: 1, x_mm: 80, y_mm: 10, w_mm: 90, h_mm: 35 })
    doc.blocks[logo.id] = logo
    doc.blocks[recipient.id] = recipient
    doc.pages[0].block_ids.push(logo.id, recipient.id)

    const clientBound = findBoundSlots(doc, 'client')
    expect(clientBound).toContain('logo-1.image')
    expect(clientBound).toContain('logo-1.caption')
    expect(clientBound).toContain('rec-1.name')
    expect(clientBound).toContain('rec-1.address')
    expect(clientBound).toContain('rec-1.contact_email')
  })
})

describe('describeSlot — provenance', () => {
  it('reports used_fallback when path is empty', () => {
    const provenance = describeSlot(slot.client('nonexistent', 'default'), ctx)
    expect(provenance.used_fallback).toBe(true)
    expect(provenance.resolved_value).toBe('default')
    expect(provenance.source).toBe('client')
  })

  it('reports overridden when override exists', () => {
    const overridden: ResolveContext = {
      ...ctx,
      overrides: { 'terms-1.body': slot.manual('60 day') },
    }
    const provenance = describeSlot(slot.client('legal_boilerplate'), overridden, 'terms-1.body')
    expect(provenance.overridden).toBe(true)
    expect(provenance.resolved_value).toBe('60 day')
  })
})
