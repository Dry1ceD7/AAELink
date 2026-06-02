/**
 * Assemble stage — block-tree edition.
 *
 * Pulls the document_template (block tree v2), the bound client_profile,
 * the workspace brand, the user, and the in-flight PuzzlePiece. Resolves
 * every slot, applies any per-assembly slot overrides, and serialises the
 * tree to HTML for the render stage.
 *
 * Backward compatibility: legacy templates with HTML/CSS source still work
 * — they fall through to the old code path and are rendered as a single
 * implicit text block.
 */

import type { Pool } from 'pg'
import type { StageResult, PuzzlePiece, ClientProfile, DocumentTemplate } from './types'
import type { DocumentTree, SlotOverrides } from './blocks'
import { validateDocument } from './blocks'
import { serializeDocument, type ImageResolver } from './serialize'
import { resolveBlockInputs, type ResolveContext } from './resolve'

export interface AssembleInput {
  pool: Pool
  workspace_id: string
  template_id: string
  piece: PuzzlePiece
  /** Per-assembly slot overrides. Stored on `aaelink.document_assemblies.overrides`. */
  overrides?: SlotOverrides
}

export interface AssembleOutput {
  html: string
  template: DocumentTemplate
  client: ClientProfile | null
  document: DocumentTree | null
  /** Fields that the template *requires* but came back empty after resolution. */
  missing_required: string[]
}

interface TemplateRow {
  id: string
  workspace_id: string
  kind: string
  name: string
  version: number
  html_source: string
  css_source: string
  required_fields: string[] | string
  page_size: string
  is_active: boolean
  schema_version: string | null
  block_tree: DocumentTree | string | null
  style_tokens: Record<string, string> | string | null
}

async function loadTemplate(pool: Pool, id: string, wsId: string): Promise<{
  template: DocumentTemplate
  doc: DocumentTree | null
} | null> {
  const { rows } = await pool.query<TemplateRow>(
    `SELECT id, workspace_id, kind, name, version, html_source, css_source,
            required_fields, page_size, is_active, schema_version, block_tree, style_tokens
     FROM aaelink.document_templates WHERE id = $1 AND workspace_id = $2`,
    [id, wsId]
  )
  const r = rows[0]
  if (!r) return null

  const template: DocumentTemplate = {
    id: r.id,
    workspace_id: r.workspace_id,
    kind: r.kind,
    name: r.name,
    version: r.version,
    html_source: r.html_source,
    css_source: r.css_source,
    required_fields: Array.isArray(r.required_fields) ? r.required_fields : JSON.parse(String(r.required_fields || '[]')),
    page_size: (r.page_size as DocumentTemplate['page_size']) || 'A4',
    is_active: r.is_active,
  }

  let doc: DocumentTree | null = null
  if (r.schema_version === '2' && r.block_tree) {
    const raw = typeof r.block_tree === 'string' ? JSON.parse(r.block_tree) : r.block_tree
    if (raw && typeof raw === 'object' && raw.schema_version === '2') {
      // Apply persisted style tokens onto the document if present.
      const tokens = typeof r.style_tokens === 'string'
        ? JSON.parse(r.style_tokens || '{}')
        : (r.style_tokens || {})
      doc = { ...(raw as DocumentTree), style_tokens: tokens }
    }
  }

  return { template, doc }
}

interface ClientRow {
  id: string
  workspace_id: string
  code: string
  name: string
  logo_bucket_key: string
  brand: ClientProfile['brand'] | string
  address: Record<string, string> | string
  tax_id: string
  phone: string
  email: string
  website: string
  legal_boilerplate: string
  metadata: Record<string, unknown> | string
}

async function loadClient(pool: Pool, id: string, wsId: string): Promise<ClientProfile | null> {
  const { rows } = await pool.query<ClientRow>(
    `SELECT id, workspace_id, code, name, logo_bucket_key, brand, address,
            tax_id, phone, email, website, legal_boilerplate, metadata
     FROM aaelink.client_profiles WHERE id = $1 AND workspace_id = $2`,
    [id, wsId]
  )
  const r = rows[0]
  if (!r) return null
  const parse = <T,>(v: T | string, fallback: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v) ?? fallback
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    code: r.code,
    name: r.name,
    logo_bucket_key: r.logo_bucket_key,
    brand: parse(r.brand, {} as ClientProfile['brand']),
    address: parse(r.address, {} as Record<string, string>),
    tax_id: r.tax_id,
    phone: r.phone,
    email: r.email,
    website: r.website,
    legal_boilerplate: r.legal_boilerplate,
    metadata: parse(r.metadata, {} as Record<string, unknown>),
  }
}

interface WorkspaceBrand {
  name: string
  address: string
  tax_id: string
  contact: string
  brand: Record<string, unknown>
  [k: string]: unknown
}

async function loadWorkspaceBrand(pool: Pool, wsId: string): Promise<WorkspaceBrand> {
  const { rows } = await pool.query<{
    display_name: string
    name: string
    settings: Record<string, unknown> | string | null
  }>(
    `SELECT display_name, name,
            COALESCE(
              (SELECT settings::text FROM aaelink.workspace_settings WHERE workspace_id = $1),
              '{}'
            )::jsonb AS settings
     FROM aaelink.workspaces WHERE id = $1`,
    [wsId]
  )
  const r = rows[0]
  const settings = (r?.settings && typeof r.settings === 'object'
    ? r.settings as Record<string, unknown>
    : (typeof r?.settings === 'string' ? JSON.parse(r.settings) : {})) as Record<string, unknown>
  const branding = (settings.branding as Record<string, unknown>) || {}
  return {
    name: String(branding.display_name || r?.display_name || 'Advanced ID Asia Engineering Co., Ltd'),
    address: String(branding.address || '116 Moo 3 T.Maekhue · Doisaket · Chiangmai 50220 · Thailand'),
    tax_id: String(branding.tax_id || ''),
    contact: String(branding.contact || ''),
    brand: branding,
  }
}

function defaultImageResolver(): ImageResolver {
  return (slotValue: string) => {
    if (!slotValue) return ''
    if (slotValue.startsWith('http://') || slotValue.startsWith('https://') || slotValue.startsWith('data:')) {
      return slotValue
    }
    // Treat the value as a bucket key; the application server proxies these.
    return `/api/files/${encodeURIComponent(slotValue)}`
  }
}

function resolvedRequiredCheck(doc: DocumentTree | null, ctx: ResolveContext, requiredFields: string[]): string[] {
  if (!requiredFields || requiredFields.length === 0) return []
  if (!doc) {
    // Legacy templates: required fields refer to PuzzlePiece.fields keys.
    return requiredFields.filter(k => {
      const v = ctx.assembly?.fields?.[k]
      return v === undefined || v === null || v === ''
    })
  }
  // Block-tree templates: required fields are slot keys (e.g. `meta-1.document_number`)
  // OR PuzzlePiece field names. Try both — flag only if both come back empty.
  return requiredFields.filter(req => {
    if (req.includes('.')) {
      // slot key — search blocks for this id and input
      const [blockId, inputKey] = req.split('.')
      const block = doc.blocks[blockId]
      if (!block) return true
      const inputs = resolveBlockInputs(block, ctx)
      const v = inputs[inputKey]
      return v === undefined || v === null || v === ''
    }
    const v = ctx.assembly?.fields?.[req]
    return v === undefined || v === null || v === ''
  })
}

export async function runAssemble(input: AssembleInput): Promise<StageResult<AssembleOutput>> {
  const loaded = await loadTemplate(input.pool, input.template_id, input.workspace_id)
  if (!loaded) return { ok: false, code: 'template_not_found', message: 'Template missing or in another workspace.' }
  const { template, doc } = loaded
  if (!template.is_active) return { ok: false, code: 'template_inactive', message: 'Template is not active.' }

  const client = input.piece.customer_id ? await loadClient(input.pool, input.piece.customer_id, input.workspace_id) : null
  const workspace = await loadWorkspaceBrand(input.pool, input.workspace_id)

  // User row — best-effort; assembled by scheduled jobs may not have a user.
  const user: ResolveContext['user'] = null
  try {
    if (input.piece.source.kind === 'manual' || input.piece.source.kind === 'ticket') {
      // try to read the assembly creator id via the document_assemblies row,
      // but the pipeline already handed us the workspace_id; user is optional.
    }
  } catch { /* ignore */ }

  const ctx: ResolveContext = {
    workspace,
    client: client
      ? { ...client }
      : null,
    user,
    ticket: null,
    assembly: input.piece,
    overrides: input.overrides,
  }

  // ── Block-tree path ────────────────────────────────────────────────────
  if (doc) {
    const issues = validateDocument(doc)
    if (issues.length) {
      const blocking = issues.filter(i => i.code !== 'orphan_block' && i.code !== 'overflow')
      if (blocking.length) {
        return {
          ok: false,
          code: 'invalid_template',
          message: `Template is malformed: ${blocking.map(i => i.message).join('; ')}`,
        }
      }
    }
    const html = serializeDocument(doc, {
      ctx,
      resolveImage: defaultImageResolver(),
    })
    const missing = resolvedRequiredCheck(doc, ctx, template.required_fields)
    if (missing.length) {
      return {
        ok: false,
        code: 'required_fields_missing',
        message: `Missing: ${missing.join(', ')}`,
        recoverable: true,
      }
    }
    return { ok: true, value: { html, template, client, document: doc, missing_required: [] } }
  }

  // ── No block tree → legacy v1 row (schema_version='1' or older) ───────
  // The legacy `html_source` + `{{placeholder}}` engine was retired in
  // v0.0.26-alpha. The Puzzle Box editor only writes v2 rows, so any row
  // hitting this branch was authored before the migration. Surface a clear
  // error pointing operators to the migration path.
  return {
    ok: false,
    code: 'legacy_template_unsupported',
    message: `Template "${template.name}" was authored against the v1 placeholder engine. Re-create it in the Puzzle Box editor to upgrade to schema_version='2'.`,
    recoverable: false,
  }
}
