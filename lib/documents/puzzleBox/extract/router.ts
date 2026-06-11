/**
 * Extraction router — picks the right strategy based on document_kind hints
 * and confidence floor. LLM is preferred when available and configured;
 * regex is the always-available fallback.
 */

import type { PuzzlePiece } from '../types'
import { extractByRegex } from './regex'
import { extractByLlm } from './llm'

const MIN_CONFIDENCE = Number(process.env.PUZZLE_BOX_MIN_CONFIDENCE || '0.4')

export interface RouterOpts {
  workspace_id: string
  /** Force a strategy; otherwise auto-route. */
  strategy?: 'regex' | 'llm' | 'auto'
}

export async function routeExtraction(
  rawText: string,
  sourceRef: string,
  opts: RouterOpts
): Promise<PuzzlePiece> {
  const strategy = opts.strategy ?? 'auto'

  if (strategy === 'regex') {
    return extractByRegex(rawText, sourceRef)
  }

  if (strategy === 'llm') {
    const piece = await extractByLlm(rawText, sourceRef, { workspace_id: opts.workspace_id })
    if (piece) return piece
    const fallback = extractByRegex(rawText, sourceRef)
    fallback.extraction.warnings.push('llm_unavailable_fallback_regex')
    return fallback
  }

  // auto: try LLM first, fall back to regex, or merge when both produce signal.
  const llm = await extractByLlm(rawText, sourceRef, { workspace_id: opts.workspace_id })
  const rx = extractByRegex(rawText, sourceRef)

  if (!llm) return rx
  if (llm.extraction.confidence >= MIN_CONFIDENCE && llm.extraction.confidence >= rx.extraction.confidence) {
    return { ...llm, fields: { ...rx.fields, ...llm.fields }, extraction: { ...llm.extraction, method: 'mixed' } }
  }
  return rx
}
