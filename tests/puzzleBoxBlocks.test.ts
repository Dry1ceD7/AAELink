/**
 * Block-tree fundamentals — slot helpers, library factory, validation.
 */

import { describe, it, expect } from 'vitest'
import {
  slot, isSlot, BLOCK_LIBRARY, validateDocument, emptyDocument,
  PAGE_DIMENSIONS_MM, type DocumentTree,
} from '@/lib/documents/puzzleBox/blocks'

describe('slot helpers', () => {
  it('builds well-formed slots', () => {
    expect(slot.manual('hi')).toEqual({ source: 'manual', path: '', fallback: 'hi' })
    expect(slot.client('logo_bucket_key')).toEqual({ source: 'client', path: 'logo_bucket_key', fallback: '' })
    expect(slot.formula('sum:assembly.line_items[].amount', '0')).toEqual({
      source: 'formula', path: 'sum:assembly.line_items[].amount', fallback: '0',
    })
  })

  it('isSlot narrows correctly', () => {
    expect(isSlot(slot.manual('x'))).toBe(true)
    expect(isSlot({ source: 'manual', path: '' })).toBe(false) // missing fallback
    expect(isSlot(null)).toBe(false)
    expect(isSlot('client.name')).toBe(false)
  })
})

describe('block library', () => {
  it('every block type has a factory', () => {
    for (const [type, spec] of Object.entries(BLOCK_LIBRARY)) {
      expect(spec.type).toBe(type)
      const layout = { page: 1, x_mm: 10, y_mm: 10, w_mm: 60, h_mm: 30 }
      const block = spec.factory(`${type}-test`, layout)
      expect(block.type).toBe(type)
      expect(block.id).toBe(`${type}-test`)
      expect(block.layout).toEqual(layout)
    }
  })

  it('logo factory produces a client-bound logo by default', () => {
    const block = BLOCK_LIBRARY.logo.factory('logo-1', { page: 1, x_mm: 10, y_mm: 10, w_mm: 60, h_mm: 25 })
    expect(block.type).toBe('logo')
    if (block.type === 'logo') {
      expect(block.inputs.image.source).toBe('client')
      expect(block.inputs.image.path).toBe('logo_bucket_key')
    }
  })

  it('totals factory wires a sum formula by default', () => {
    const block = BLOCK_LIBRARY.totals.factory('tot-1', { page: 1, x_mm: 100, y_mm: 200, w_mm: 90, h_mm: 30 })
    expect(block.type).toBe('totals')
    if (block.type === 'totals') {
      const totalRow = block.inputs.rows.find(r => r.key === 'total')
      expect(totalRow?.value.source).toBe('formula')
      expect(totalRow?.value.path).toBe('sum:assembly.line_items[].amount')
    }
  })
})

describe('validateDocument', () => {
  function withBlock(): DocumentTree {
    const doc = emptyDocument('A4')
    const block = BLOCK_LIBRARY.logo.factory('logo-1', { page: 1, x_mm: 10, y_mm: 10, w_mm: 60, h_mm: 25 })
    doc.blocks[block.id] = block
    doc.pages[0].block_ids.push(block.id)
    return doc
  }

  it('passes a well-formed document', () => {
    expect(validateDocument(withBlock())).toEqual([])
  })

  it('flags overflow', () => {
    const doc = withBlock()
    doc.blocks['logo-1'].layout = { page: 1, x_mm: 10, y_mm: 290, w_mm: 200, h_mm: 50 }
    const issues = validateDocument(doc)
    expect(issues.some(i => i.code === 'overflow')).toBe(true)
  })

  it('flags orphan blocks', () => {
    const doc = withBlock()
    const block = BLOCK_LIBRARY.note.factory('note-1', { page: 1, x_mm: 10, y_mm: 250, w_mm: 100, h_mm: 12 })
    doc.blocks[block.id] = block
    // intentionally not adding to a page
    const issues = validateDocument(doc)
    expect(issues.some(i => i.code === 'orphan_block' && i.block_id === 'note-1')).toBe(true)
  })

  it('flags duplicate block ids when map key disagrees with block.id', () => {
    const doc = withBlock()
    doc.blocks['logo-2'] = { ...doc.blocks['logo-1'] }
    const issues = validateDocument(doc)
    expect(issues.some(i => i.code === 'invalid_layout' && i.block_id === 'logo-2')).toBe(true)
  })

  it('flags page references to missing blocks', () => {
    const doc = withBlock()
    doc.pages[0].block_ids.push('does-not-exist')
    const issues = validateDocument(doc)
    expect(issues.some(i => i.code === 'page_block_missing')).toBe(true)
  })

  it('A4 dimensions are 210×297', () => {
    expect(PAGE_DIMENSIONS_MM.A4).toEqual({ w: 210, h: 297 })
  })
})
