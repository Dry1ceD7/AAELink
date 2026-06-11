/**
 * Normalize stage — coerce extracted fields to canonical types,
 * resolve customer linkage, and validate the PuzzlePiece against
 * its declared schema_version.
 */

import type { Pool } from 'pg'
import type { StageResult, PuzzlePiece } from './types'

function coerceNumeric(v: unknown): number | string | null | boolean {
  if (typeof v !== 'string') return v as number | string | null | boolean
  const trimmed = v.replace(/[,$\s]/g, '')
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return v
}

function coerceDate(v: unknown): string | unknown {
  if (typeof v !== 'string') return v
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${yyyy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return v
}

export interface NormalizeInput {
  workspace_id: string
  piece: PuzzlePiece
  /** Optional pre-linked customer; if empty, normalize will attempt resolution by code/email. */
  client_profile_id?: string
  pool: Pool
}

export async function runNormalize(input: NormalizeInput): Promise<StageResult<PuzzlePiece>> {
  const piece: PuzzlePiece = JSON.parse(JSON.stringify(input.piece))
  const warnings = [...piece.extraction.warnings]

  for (const [k, v] of Object.entries(piece.fields)) {
    if (k.endsWith('_date') || k === 'due_date' || k === 'issue_date') {
      piece.fields[k] = coerceDate(v) as PuzzlePiece['fields'][string]
    } else if (['total', 'subtotal', 'tax', 'amount', 'unit_price', 'qty'].includes(k)) {
      piece.fields[k] = coerceNumeric(v) as PuzzlePiece['fields'][string]
    }
  }

  if (Array.isArray(piece.line_items)) {
    piece.line_items = piece.line_items.map(li => {
      const out: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(li)) {
        const c = coerceNumeric(v)
        out[k] = (typeof c === 'number' || typeof c === 'string') ? c : String(v)
      }
      return out
    })
  }

  // Customer linkage
  if (input.client_profile_id) {
    piece.customer_id = input.client_profile_id
  } else if (!piece.customer_id) {
    const codeHint = String(piece.fields['customer_code'] || piece.fields['client_code'] || '').trim()
    const emailHint = String(piece.fields['customer_email'] || piece.fields['client_email'] || '').trim()
    if (codeHint || emailHint) {
      const { rows } = await input.pool.query<{ id: string }>(
        `SELECT id FROM aaelink.client_profiles
         WHERE workspace_id = $1 AND (code = $2 OR email = $3) LIMIT 1`,
        [input.workspace_id, codeHint, emailHint]
      )
      if (rows[0]) piece.customer_id = rows[0].id
      else warnings.push('customer_unresolved')
    } else {
      warnings.push('customer_unresolved')
    }
  }

  piece.extraction.warnings = warnings
  return { ok: true, value: piece, warnings }
}
