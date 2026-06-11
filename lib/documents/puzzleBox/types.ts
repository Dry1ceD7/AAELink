/**
 * Puzzle Box — single boundary type between extraction and assembly.
 * Versioned so downstream consumers can evolve without breaking pipelines.
 */

export type DocumentKind = 'invoice' | 'quote' | 'sow' | 'report' | 'memo' | 'receipt' | string

export interface PuzzlePiece {
  schema_version: '1'
  source: { kind: 'upload' | 'email' | 'manual' | 'ticket'; ref: string }
  customer_id: string
  document_kind: DocumentKind
  fields: Record<string, string | number | boolean | null>
  line_items?: Array<Record<string, string | number>>
  attachments?: Array<{ key: string; name: string; mime: string }>
  extraction: {
    method: 'regex' | 'llm' | 'manual' | 'mixed'
    confidence: number
    model?: string
    warnings: string[]
  }
}

export type PipelineStage =
  | 'ingested'
  | 'extracted'
  | 'normalized'
  | 'assembled'
  | 'rendered'
  | 'delivered'
  | 'failed'

export const STAGE_ORDER: PipelineStage[] = [
  'ingested', 'extracted', 'normalized', 'assembled', 'rendered', 'delivered',
]

export type StageStatus = 'started' | 'ok' | 'failed' | 'skipped'

export type StageResult<T> =
  | { ok: true; value: T; warnings?: string[] }
  | { ok: false; code: string; message: string; recoverable?: boolean }

export interface AssemblyRecord {
  id: string
  workspace_id: string
  template_id: string | null
  client_profile_id: string | null
  piece: PuzzlePiece | null
  stage: PipelineStage
  rendered_html: string
  output_bucket_key: string
  delivery_channel_id: string | null
  delivery_message_id: string
  ticket_id: string | null
  /** Per-assembly slot overrides keyed by `<block_id>.<input_path>`. */
  overrides: Record<string, unknown>
  error: string
  created_by: string | null
  created_at: number
  updated_at: number
}

export interface ClientProfile {
  id: string
  workspace_id: string
  code: string
  name: string
  logo_bucket_key: string
  brand: { primary?: string; accent?: string; font_family?: string; footer_html?: string; [k: string]: unknown }
  address: Record<string, string>
  tax_id: string
  phone: string
  email: string
  website: string
  legal_boilerplate: string
  metadata: Record<string, unknown>
}

export interface DocumentTemplate {
  id: string
  workspace_id: string
  kind: DocumentKind
  name: string
  version: number
  html_source: string
  css_source: string
  required_fields: string[]
  page_size: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5'
  is_active: boolean
}
