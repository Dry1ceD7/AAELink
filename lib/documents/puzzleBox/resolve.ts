/**
 * Slot resolver — turns a `Slot` into a final string given the assembly
 * context. Pure, no I/O, fully testable. Call sites:
 *   - lib/puzzleBox/render.ts (template assembly)
 *   - app/components/* (live editor preview)
 */

import type { ClientProfile, PuzzlePiece } from './types'
import type { Slot, SlotOverrides, Block, BlockType, DocumentTree } from './blocks'
import { isSlot } from './blocks'

export interface ResolveContext {
  workspace: {
    name?: string
    address?: string
    tax_id?: string
    contact?: string
    brand?: Record<string, unknown>
    [k: string]: unknown
  }
  client: (Partial<ClientProfile> & Record<string, unknown>) | null
  user: {
    id?: string
    username?: string
    first_name?: string
    last_name?: string
    email?: string
    job_title?: string
    phone?: string
    signature_image_key?: string
    [k: string]: unknown
  } | null
  ticket: {
    id?: string
    title?: string
    description?: string
    status?: string
    priority?: string
    [k: string]: unknown
  } | null
  assembly: PuzzlePiece | null
  /** Per-document overrides keyed by `<block_id>.<input_path>`. */
  overrides?: SlotOverrides
}

/**
 * Resolve a value at a dot-path inside an object. Supports:
 *
 *   - simple keys: `client.name`
 *   - nested keys: `address.line1`
 *   - array indices: `line_items[2].description`
 *   - the index sugar `[]` to mean "every element" (used by formulas)
 */
function readPath(root: unknown, path: string): unknown {
  if (!path) return root
  if (root == null) return undefined

  const tokens: Array<string | number | '*'> = []
  let buf = ''
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === '.') {
      if (buf) { tokens.push(buf); buf = '' }
    } else if (ch === '[') {
      if (buf) { tokens.push(buf); buf = '' }
      // collect until ]
      let j = i + 1
      while (j < path.length && path[j] !== ']') j++
      const inside = path.slice(i + 1, j).trim()
      if (inside === '' ) tokens.push('*')
      else if (/^\d+$/.test(inside)) tokens.push(Number(inside))
      else tokens.push(inside) // string key inside brackets
      i = j
    } else {
      buf += ch
    }
  }
  if (buf) tokens.push(buf)

  let cur: unknown = root
  for (const tok of tokens) {
    if (cur == null) return undefined
    if (tok === '*') {
      if (!Array.isArray(cur)) return undefined
      // The '*' token is consumed by formula evaluators above; bare reads
      // collapse to undefined to make it explicit.
      return undefined
    }
    if (typeof tok === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[tok]
    } else {
      cur = (cur as Record<string, unknown>)[tok]
    }
  }
  return cur
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * Read the raw slot value (number, string, array, object, or undefined).
 * `resolveSlot` is the string-returning convenience; `resolveSlotValue`
 * returns the structured value so block renderers that need the array
 * (line_items.rows, totals.rows) can use it without round-tripping JSON.
 */
function resolveSlotValue(slot: Slot, ctx: ResolveContext, overrideKey?: string): unknown {
  if (overrideKey && ctx.overrides && ctx.overrides[overrideKey]) {
    const overridden = ctx.overrides[overrideKey]
    return resolveSlotValue(overridden, { ...ctx, overrides: undefined })
  }
  switch (slot.source) {
    case 'manual':
      return slot.fallback
    case 'client':
      return readPath(ctx.client, slot.path) ?? slot.fallback
    case 'workspace':
      return readPath(ctx.workspace, slot.path) ?? slot.fallback
    case 'assembly':
      return readPath(ctx.assembly, slot.path) ?? slot.fallback
    case 'ticket':
      return readPath(ctx.ticket, slot.path) ?? slot.fallback
    case 'user':
      return readPath(ctx.user, slot.path) ?? slot.fallback
    case 'formula': {
      const n = evalFormula(slot.path, ctx)
      return n != null ? n : slot.fallback
    }
    default:
      return slot.fallback
  }
}

// ── Formula evaluator ────────────────────────────────────────────────────

const FORMULA_OPS = ['sum', 'avg', 'min', 'max', 'count'] as const
type FormulaOp = typeof FORMULA_OPS[number]

function isFormulaOp(s: string): s is FormulaOp {
  return (FORMULA_OPS as readonly string[]).includes(s)
}

/**
 * Tiny formula language: `<op>:<root_path>[].<field>`.
 *
 *   sum:assembly.line_items[].amount
 *   count:assembly.line_items
 *   max:assembly.line_items[].qty
 *
 * Anything not matching the grammar collapses to `fallback`.
 */
function evalFormula(expr: string, ctx: ResolveContext): number | null {
  const colonIdx = expr.indexOf(':')
  if (colonIdx < 0) return null
  const op = expr.slice(0, colonIdx)
  const rest = expr.slice(colonIdx + 1)
  if (!isFormulaOp(op)) return null

  // Locate the [] split.
  const bracketIdx = rest.indexOf('[]')
  let arrayPath: string
  let fieldPath: string
  if (bracketIdx < 0) {
    arrayPath = rest
    fieldPath = ''
  } else {
    arrayPath = rest.slice(0, bracketIdx)
    fieldPath = rest.slice(bracketIdx + 2).replace(/^\./, '')
  }

  const head = arrayPath.split('.', 1)[0]
  const rest2 = arrayPath.slice(head.length).replace(/^\./, '')
  const root: unknown = (ctx as unknown as Record<string, unknown>)[head]
  const arr = readPath(root, rest2)

  if (!Array.isArray(arr)) return null

  if (op === 'count') return arr.length

  const numbers: number[] = []
  for (const item of arr) {
    const raw = fieldPath ? readPath(item, fieldPath) : item
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
    if (Number.isFinite(n)) numbers.push(n)
  }
  if (numbers.length === 0) return null

  switch (op) {
    case 'sum': return numbers.reduce((a, b) => a + b, 0)
    case 'avg': return numbers.reduce((a, b) => a + b, 0) / numbers.length
    case 'min': return Math.min(...numbers)
    case 'max': return Math.max(...numbers)
    default: return null
  }
}

// ── Public resolver ──────────────────────────────────────────────────────

/**
 * Resolve a single slot to its final string. The `overrideKey`, when given,
 * makes the resolver consult `ctx.overrides[overrideKey]` first and use that
 * slot definition instead. This is how per-document overrides plug in.
 */
export function resolveSlot(slot: Slot, ctx: ResolveContext, overrideKey?: string): string {
  const raw = resolveSlotValue(slot, ctx, overrideKey)
  if (typeof raw === 'string' && raw === '' && slot.fallback) return slot.fallback
  return stringify(raw) || slot.fallback
}

// ── Block resolution ─────────────────────────────────────────────────────

/**
 * Walk a block's `inputs` and return a parallel structure where every Slot
 * is replaced with its resolved value (raw — strings, numbers, arrays, or
 * objects). The serializer's per-block renderers decide how to format from
 * there. This is what powers the line_items / totals tables.
 */
export function resolveBlockInputs(block: Block, ctx: ResolveContext): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const inputs = (block as unknown as { inputs: Record<string, unknown> }).inputs || {}

  for (const [key, value] of Object.entries(inputs)) {
    const overrideKey = `${block.id}.${key}`

    if (isSlot(value)) {
      out[key] = resolveSlotValue(value, ctx, overrideKey)
    } else if (Array.isArray(value)) {
      out[key] = value.map((entry, i) => resolveEntry(entry, ctx, `${overrideKey}[${i}]`))
    } else if (value && typeof value === 'object') {
      out[key] = resolveEntry(value, ctx, overrideKey)
    } else {
      out[key] = value
    }
  }
  return out
}

function resolveEntry(entry: unknown, ctx: ResolveContext, overrideKey: string): unknown {
  if (isSlot(entry)) return resolveSlotValue(entry, ctx, overrideKey)
  if (Array.isArray(entry)) return entry.map((e, i) => resolveEntry(e, ctx, `${overrideKey}[${i}]`))
  if (entry && typeof entry === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
      out[k] = resolveEntry(v, ctx, `${overrideKey}.${k}`)
    }
    return out
  }
  return entry
}

// ── Field provenance (for the editor tooltip) ────────────────────────────

export interface SlotProvenance {
  source: Slot['source']
  path: string
  resolved_value: string
  used_fallback: boolean
  override_key?: string
  overridden?: boolean
}

export function describeSlot(slot: Slot, ctx: ResolveContext, overrideKey?: string): SlotProvenance {
  const overridden = !!(overrideKey && ctx.overrides && ctx.overrides[overrideKey])
  const resolved = resolveSlot(slot, ctx, overrideKey)
  const usedFallback = (() => {
    if (slot.source === 'manual') return false
    if (slot.source === 'formula') {
      const n = evalFormula(slot.path, ctx)
      return n == null
    }
    const root = (ctx as unknown as Record<string, unknown>)[slot.source]
    const v = readPath(root, slot.path)
    return !stringify(v)
  })()
  return {
    source: slot.source,
    path: slot.path,
    resolved_value: resolved,
    used_fallback: usedFallback,
    override_key: overrideKey,
    overridden,
  }
}

// ── Bound-block selection helper (for editor "swap client" preview) ──────

/**
 * Return the set of slot keys (`<block_id>.<input>`) on a document that are
 * bound to a given source. The editor uses this to highlight every block
 * that will swap when the user picks a different client.
 */
export function findBoundSlots(doc: DocumentTree, source: Slot['source']): string[] {
  const keys: string[] = []
  for (const block of Object.values(doc.blocks)) {
    const inputs = (block as unknown as { inputs: Record<string, unknown> }).inputs || {}
    walkSlots(inputs, '', (key, slot) => {
      if (slot.source === source) keys.push(`${block.id}.${key}`)
    })
  }
  return keys
}

function walkSlots(node: unknown, prefix: string, visit: (key: string, slot: Slot) => void): void {
  if (isSlot(node)) {
    visit(prefix.replace(/^\./, ''), node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((entry, i) => walkSlots(entry, `${prefix}[${i}]`, visit))
    return
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkSlots(v, `${prefix}.${k}`, visit)
    }
  }
}

export function blockTypesByBoundSource(doc: DocumentTree, source: Slot['source']): Set<BlockType> {
  const types = new Set<BlockType>()
  for (const block of Object.values(doc.blocks)) {
    let bound = false
    const inputs = (block as unknown as { inputs: Record<string, unknown> }).inputs || {}
    walkSlots(inputs, '', (_k, slot) => { if (slot.source === source) bound = true })
    if (bound) types.add(block.type)
  }
  return types
}
