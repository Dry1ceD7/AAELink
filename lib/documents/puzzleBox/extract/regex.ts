/**
 * Rule-based extraction — high-confidence patterns for well-formed inputs
 * (invoices, receipts, quotes). Returns a partial PuzzlePiece, downstream
 * stages fill the rest.
 */

import type { PuzzlePiece, DocumentKind } from '../types'

const PATTERNS: Array<{ key: string; re: RegExp; transform?: (v: string) => string | number }> = [
  { key: 'invoice_number', re: /(?:invoice|inv)[\s#:]+([A-Z0-9-]{3,})/i },
  { key: 'quote_number',   re: /(?:quote|quotation)[\s#:]+([A-Z0-9-]{3,})/i },
  { key: 'po_number',      re: /(?:po|p\.o\.)[\s#:]+([A-Z0-9-]{3,})/i },
  { key: 'due_date',       re: /due\s+(?:date|by)[\s:]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i },
  { key: 'issue_date',     re: /(?:date|issued)[\s:]+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i },
  { key: 'subtotal',       re: /\bsub[-\s]?total[\s:]+\$?\s?([\d,]+\.?\d*)/i, transform: v => Number(v.replace(/,/g, '')) },
  { key: 'tax',            re: /\b(?:tax|vat)[\s:]+\$?\s?([\d,]+\.?\d*)/i, transform: v => Number(v.replace(/,/g, '')) },
  { key: 'total',          re: /(?:^|\n)\s*(?:total|amount\s+due)[\s:]+\$?\s?([\d,]+\.?\d*)/i, transform: v => Number(v.replace(/,/g, '')) },
  { key: 'tax_id',         re: /(?:tax\s*id|vat\s*number|ein)[\s:]+([A-Z0-9-]{6,})/i },
]

function detectKind(text: string): DocumentKind {
  const t = text.toLowerCase()
  if (/\binvoice\b/.test(t)) return 'invoice'
  if (/\bquot(e|ation)\b/.test(t)) return 'quote'
  if (/\bstatement of work\b|\bsow\b/.test(t)) return 'sow'
  if (/\breceipt\b/.test(t)) return 'receipt'
  if (/\bmemo\b/.test(t)) return 'memo'
  return 'report'
}

export function extractByRegex(rawText: string, sourceRef: string): PuzzlePiece {
  const fields: PuzzlePiece['fields'] = {}
  const warnings: string[] = []
  let matched = 0
  for (const p of PATTERNS) {
    const m = rawText.match(p.re)
    if (m && m[1]) {
      fields[p.key] = p.transform ? p.transform(m[1]) : m[1].trim()
      matched++
    }
  }
  if (matched === 0) warnings.push('no_patterns_matched')

  return {
    schema_version: '1',
    source: { kind: 'upload', ref: sourceRef },
    customer_id: '',
    document_kind: detectKind(rawText),
    fields,
    extraction: {
      method: 'regex',
      confidence: Math.min(1, matched / PATTERNS.length + 0.2),
      warnings,
    },
  }
}
