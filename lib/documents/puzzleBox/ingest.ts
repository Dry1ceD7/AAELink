/**
 * Ingest stage — accepts raw input (text or PDF buffer reference) and
 * routes it through the extraction layer to produce a PuzzlePiece.
 */

import type { StageResult, PuzzlePiece } from './types'
import { routeExtraction } from './extract/router'

export interface IngestInput {
  workspace_id: string
  source_kind: 'upload' | 'email' | 'manual' | 'ticket'
  source_ref: string
  raw_text: string
  /** If true, caller has already supplied a fully-formed PuzzlePiece via piece. */
  prebuilt_piece?: PuzzlePiece
  strategy?: 'regex' | 'llm' | 'auto'
}

export async function runIngest(input: IngestInput): Promise<StageResult<PuzzlePiece>> {
  if (input.prebuilt_piece) {
    if (input.prebuilt_piece.schema_version !== '1') {
      return { ok: false, code: 'unsupported_schema_version', message: 'Only schema_version=1 accepted.' }
    }
    return { ok: true, value: input.prebuilt_piece }
  }

  const raw = (input.raw_text || '').trim()
  if (!raw) {
    return { ok: false, code: 'empty_input', message: 'No raw text provided for extraction.' }
  }

  try {
    const piece = await routeExtraction(raw, input.source_ref, {
      workspace_id: input.workspace_id,
      strategy: input.strategy,
    })
    piece.source.kind = input.source_kind
    return { ok: true, value: piece, warnings: piece.extraction.warnings }
  } catch (e) {
    return { ok: false, code: 'extraction_failed', message: e instanceof Error ? e.message : String(e), recoverable: true }
  }
}
