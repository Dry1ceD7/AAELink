/**
 * LLM extraction — calls the workspace's configured AI gateway with a
 * schema-constrained prompt. Returns a typed PuzzlePiece on success.
 *
 * Implementation note: this is a transport boundary. The actual model call
 * is delegated to `process.env.AI_GATEWAY_URL` so we never bake provider
 * choice into the pipeline. Falls back to regex if gateway is absent.
 */

import type { PuzzlePiece } from '../types'

const SYSTEM_PROMPT = `Extract structured fields from the supplied document text.
Return STRICT JSON matching this schema:
{
  "document_kind": "invoice|quote|sow|report|memo|receipt",
  "fields": { "key": "value" },
  "line_items": [{"description":"","qty":1,"unit_price":0,"amount":0}],
  "confidence": 0..1
}
Do not invent fields that are not in the source.`

export async function extractByLlm(
  rawText: string,
  sourceRef: string,
  opts: { workspace_id: string; timeout_ms?: number } = { workspace_id: '' }
): Promise<PuzzlePiece | null> {
  const gateway = (process.env.AI_GATEWAY_URL || '').trim()
  if (!gateway) return null

  const res = await fetch(`${gateway.replace(/\/+$/, '')}/v1/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
      input: rawText.slice(0, 32_000),
      workspace_id: opts.workspace_id,
      mode: 'json',
    }),
    signal: AbortSignal.timeout(opts.timeout_ms ?? 60_000),
  }).catch(() => null)

  if (!res || !res.ok) return null
  const data = (await res.json().catch(() => null)) as {
    document_kind?: string
    fields?: Record<string, string | number | boolean | null>
    line_items?: Array<Record<string, string | number>>
    confidence?: number
    model?: string
  } | null
  if (!data || typeof data.fields !== 'object') return null

  return {
    schema_version: '1',
    source: { kind: 'upload', ref: sourceRef },
    customer_id: '',
    document_kind: (data.document_kind as PuzzlePiece['document_kind']) || 'report',
    fields: data.fields || {},
    line_items: Array.isArray(data.line_items) ? data.line_items : undefined,
    extraction: {
      method: 'llm',
      confidence: Math.min(1, Math.max(0, Number(data.confidence) || 0.5)),
      model: data.model,
      warnings: [],
    },
  }
}
