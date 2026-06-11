/**
 * Unit tests for D7 Block Kit validation (lib/blockkit/validate.ts). Pure — no DB.
 */
import { describe, it, expect } from 'vitest'
import { validateBlocks } from '@/lib/blockkit/validate'

const txt = (t = 'hi') => ({ type: 'plain_text', text: t })
const button = (t = 'Go') => ({ type: 'button', text: txt(t) })

describe('validateBlocks — valid', () => {
  it('accepts a representative valid block array', () => {
    const res = validateBlocks([
      { type: 'header', text: txt('Title') },
      { type: 'section', text: { type: 'mrkdwn', text: '*bold*' }, accessory: button() },
      { type: 'section', fields: [txt('a'), txt('b')] },
      { type: 'divider' },
      { type: 'image', image_url: 'https://x/i.png', alt_text: 'i' },
      { type: 'context', elements: [txt('c'), { type: 'image', image_url: 'https://x/i.png', alt_text: 'i' }] },
      { type: 'actions', elements: [button('A'), { type: 'datepicker' }] },
      { type: 'input', label: txt('Name'), element: { type: 'plain_text_input' } },
    ])
    expect(res).toEqual({ ok: true, errors: [] })
  })
})

describe('validateBlocks — structural failures', () => {
  it('rejects a non-array', () => {
    expect(validateBlocks({} as unknown).ok).toBe(false)
    expect(validateBlocks(null as unknown).errors[0].message).toBe('must_be_array')
  })

  it('rejects unknown block types', () => {
    const res = validateBlocks([{ type: 'frobnicate' }])
    expect(res.ok).toBe(false)
    expect(res.errors.some(e => e.message === 'unknown_block_type')).toBe(true)
  })

  it('requires section text or fields', () => {
    const res = validateBlocks([{ type: 'section' }])
    expect(res.errors.some(e => e.message === 'section_requires_text_or_fields')).toBe(true)
  })

  it('enforces header is plain_text and length', () => {
    expect(validateBlocks([{ type: 'header', text: { type: 'mrkdwn', text: 'x' } }]).ok).toBe(false)
    const long = validateBlocks([{ type: 'header', text: txt('x'.repeat(151)) }])
    expect(long.errors.some(e => e.message.includes('max_150'))).toBe(true)
  })

  it('rejects non-interactive elements in actions and buttons without text', () => {
    expect(validateBlocks([{ type: 'actions', elements: [{ type: 'image', image_url: 'u', alt_text: 'a' }] }]).ok).toBe(false)
    const noText = validateBlocks([{ type: 'actions', elements: [{ type: 'button' }] }])
    expect(noText.ok).toBe(false)
    expect(noText.errors.some(e => e.path.includes('text'))).toBe(true)
  })

  it('enforces the actions element count and total block count', () => {
    const tooManyActions = validateBlocks([{ type: 'actions', elements: Array(26).fill(button()) }])
    expect(tooManyActions.errors.some(e => e.message.includes('1-25'))).toBe(true)

    const tooManyBlocks = validateBlocks(Array(51).fill({ type: 'divider' }))
    expect(tooManyBlocks.errors.some(e => e.message.includes('max_50'))).toBe(true)
  })

  it('requires input label (plain_text) and an interactive element', () => {
    const res = validateBlocks([{ type: 'input', label: { type: 'mrkdwn', text: 'x' }, element: { type: 'nope' } }])
    expect(res.ok).toBe(false)
    expect(res.errors.some(e => e.path.endsWith('label.type'))).toBe(true)
    expect(res.errors.some(e => e.message === 'not_an_interactive_element')).toBe(true)
  })
})
