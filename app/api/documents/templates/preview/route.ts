import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { validateDocument, type DocumentTree, type SlotOverrides } from '@/lib/documents/puzzleBox/blocks'
import { isSlot } from '@/lib/documents/puzzleBox/blocks'
import { serializeDocument } from '@/lib/documents/puzzleBox/serialize'
import type { ResolveContext } from '@/lib/documents/puzzleBox/resolve'
import type { ClientProfile, PuzzlePiece } from '@/lib/documents/puzzleBox/types'

/**
 * POST /api/documents/templates/preview
 *
 * Returns the rendered HTML for a block tree resolved against a chosen
 * client profile, an in-flight PuzzlePiece, and any per-document overrides.
 * Pure — does not persist anything. The editor's live preview drives this.
 *
 * Body:
 *   {
 *     workspace_id: string,
 *     block_tree: DocumentTree,
 *     style_tokens?: Record<string, string>,
 *     client_profile_id?: string,
 *     piece?: PuzzlePiece,
 *     overrides?: SlotOverrides,
 *   }
 */

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

function parse<T>(v: T | string, fallback: T): T {
  return (typeof v === 'string' ? (JSON.parse(v) as T) : v) ?? fallback
}

function sanitiseOverrides(input: unknown): SlotOverrides {
  if (!input || typeof input !== 'object') return {}
  const out: SlotOverrides = {}
  let count = 0
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 200) break
    if (typeof key !== 'string' || key.length > 200) continue
    if (!isSlot(value)) continue
    out[key] = value
    count++
  }
  return out
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    block_tree?: DocumentTree
    style_tokens?: Record<string, string>
    client_profile_id?: string
    piece?: PuzzlePiece
    overrides?: unknown
  }

  const wsId = String(body.workspace_id || '').trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, wsId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const tree = body.block_tree
  if (!tree || tree.schema_version !== '2') {
    return NextResponse.json({ error: 'invalid_block_tree' }, { status: 400 })
  }
  const issues = validateDocument(tree)
  const blocking = issues.filter(i => i.code !== 'orphan_block' && i.code !== 'overflow')
  if (blocking.length) {
    return NextResponse.json({ error: 'invalid_block_tree', issues: blocking }, { status: 400 })
  }

  // Apply preview-only style tokens onto the tree
  const docForRender: DocumentTree = body.style_tokens
    ? { ...tree, style_tokens: { ...(tree.style_tokens || {}), ...body.style_tokens } }
    : tree

  // Load client (optional)
  let client: ClientProfile | null = null
  if (body.client_profile_id) {
    const { rows } = await pool.query<ClientRow>(
      `SELECT id, workspace_id, code, name, logo_bucket_key, brand, address,
              tax_id, phone, email, website, legal_boilerplate, metadata
       FROM aaelink.client_profiles WHERE id = $1 AND workspace_id = $2`,
      [body.client_profile_id, wsId]
    )
    if (rows[0]) {
      client = {
        id: rows[0].id,
        workspace_id: rows[0].workspace_id,
        code: rows[0].code,
        name: rows[0].name,
        logo_bucket_key: rows[0].logo_bucket_key,
        brand: parse(rows[0].brand, {} as ClientProfile['brand']),
        address: parse(rows[0].address, {} as Record<string, string>),
        tax_id: rows[0].tax_id,
        phone: rows[0].phone,
        email: rows[0].email,
        website: rows[0].website,
        legal_boilerplate: rows[0].legal_boilerplate,
        metadata: parse(rows[0].metadata, {} as Record<string, unknown>),
      }
    }
  }

  // Workspace branding
  const { rows: wsRows } = await pool.query<{ display_name: string; name: string }>(
    `SELECT display_name, name FROM aaelink.workspaces WHERE id = $1`, [wsId]
  )
  const workspace = {
    name: wsRows[0]?.display_name || 'Advanced ID Asia Engineering Co., Ltd',
    address: '116 Moo 3 T.Maekhue · Doisaket · Chiangmai 50220 · Thailand',
    tax_id: '',
    contact: '',
    brand: {},
  }

  // Sample piece for preview when none supplied
  const piece: PuzzlePiece = body.piece || {
    schema_version: '1',
    source: { kind: 'manual', ref: '' },
    customer_id: client?.id || '',
    document_kind: 'invoice',
    fields: {
      invoice_number: 'INV-PREVIEW-0001',
      issue_date: new Date().toISOString().slice(0, 10),
      currency: 'USD',
      total: 0,
    },
    line_items: [
      { description: 'Sample item', qty: 1, unit_price: 100, amount: 100 },
    ],
    extraction: { method: 'manual', confidence: 1, warnings: [] },
  }

  const ctx: ResolveContext = {
    workspace,
    client: client ? { ...client } : null,
    user: null,
    ticket: null,
    assembly: piece,
    overrides: sanitiseOverrides(body.overrides),
  }

  const html = serializeDocument(docForRender, {
    ctx,
    resolveImage: (slotValue) => {
      if (!slotValue) return ''
      if (slotValue.startsWith('http://') || slotValue.startsWith('https://') || slotValue.startsWith('data:')) return slotValue
      return `/api/files/${encodeURIComponent(slotValue)}`
    },
    watermark: 'PREVIEW',
  })

  return NextResponse.json({ html, issues })
}

export const POST = tracedRoute('POST', '/api/documents/templates/preview', _POST)
