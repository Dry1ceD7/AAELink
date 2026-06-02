/**
 * Block tree → HTML serializer.
 *
 * Produces a single HTML document with absolute mm positions inside `.page`
 * containers. Stirling-PDF respects @page sizing so the output paginates
 * cleanly. The serializer is pure — it takes already-resolved block inputs
 * (from resolveBlockInputs) and an absolute logo URL resolver, no I/O.
 */

import type {
  Block, DocumentTree, Page, BlockStyle, BlockLayout,
  LineItemsBlock, TotalsBlock,
} from './blocks'
import { PAGE_DIMENSIONS_MM } from './blocks'
import { resolveBlockInputs, type ResolveContext } from './resolve'

/** Caller supplies a mapper for image references — we don't import S3 here. */
export interface ImageResolver {
  /** Convert a slot value (bucket key or absolute URL) into something the
   *  renderer can resolve. Return empty string to omit the image. */
  (slotValue: string): string
}

export interface SerializeOptions {
  ctx: ResolveContext
  resolveImage: ImageResolver
  /** Inject extra CSS (brand tokens, watermark, etc.). */
  extra_css?: string
  /** Stamp this string diagonally on every page. */
  watermark?: string
}

const ESCAPE_HTML_RE = /[&<>"']/g
const ESCAPE_HTML_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
function esc(s: string): string {
  return String(s ?? '').replace(ESCAPE_HTML_RE, c => ESCAPE_HTML_MAP[c])
}

function styleAttr(style: BlockStyle | undefined): string {
  if (!style) return ''
  const parts: string[] = []
  if (style.align) parts.push(`text-align:${style.align}`)
  if (style.font_size_pt) parts.push(`font-size:${style.font_size_pt}pt`)
  if (style.font_weight === 'bold') parts.push('font-weight:bold')
  if (style.italic) parts.push('font-style:italic')
  if (style.color) parts.push(`color:${style.color}`)
  if (style.background) parts.push(`background:${style.background}`)
  if (style.border && style.border !== 'none') {
    parts.push(`border:${style.border === 'thick' ? '1.5pt' : '0.5pt'} solid currentColor`)
  }
  if (style.padding_mm != null) parts.push(`padding:${style.padding_mm}mm`)
  return parts.length ? ` style="${parts.join(';')}"` : ''
}

function layoutWrapperStyle(layout: BlockLayout): string {
  return [
    'position:absolute',
    `left:${layout.x_mm}mm`,
    `top:${layout.y_mm}mm`,
    `width:${layout.w_mm}mm`,
    `height:${layout.h_mm}mm`,
    'overflow:hidden',
  ].join(';')
}

// ── Per-block HTML emitters ──────────────────────────────────────────────

interface RenderArg {
  block: Block
  inputs: Record<string, unknown>
  opts: SerializeOptions
}

function renderLogo({ inputs, opts }: RenderArg): string {
  const image = String(inputs.image || '')
  const caption = inputs.caption ? String(inputs.caption) : ''
  const fit = (inputs.fit as string) === 'cover' ? 'cover' : 'contain'
  if (!image) {
    return caption ? `<div class="bx-caption">${esc(caption)}</div>` : ''
  }
  const src = opts.resolveImage(image)
  if (!src) return caption ? `<div class="bx-caption">${esc(caption)}</div>` : ''
  return `<div class="bx-logo">
    <img src="${esc(src)}" alt="${esc(caption || 'Logo')}" style="max-width:100%;max-height:100%;object-fit:${fit}" />
    ${caption ? `<div class="bx-caption">${esc(caption)}</div>` : ''}
  </div>`
}

function renderSenderHeader({ inputs }: RenderArg): string {
  const name = String(inputs.name || '')
  const address = String(inputs.address || '')
  const taxId = String(inputs.tax_id || '')
  const contact = String(inputs.contact || '')
  return `<div class="bx-sender">
    ${name ? `<div class="bx-sender-name">${esc(name)}</div>` : ''}
    ${address ? `<div class="bx-sender-line">${esc(address)}</div>` : ''}
    ${taxId ? `<div class="bx-sender-line">Tax ID: ${esc(taxId)}</div>` : ''}
    ${contact ? `<div class="bx-sender-line">${esc(contact)}</div>` : ''}
  </div>`
}

function renderRecipient({ inputs }: RenderArg): string {
  const name = String(inputs.name || '')
  const address = String(inputs.address || '')
  const contactName = String(inputs.contact_name || '')
  const contactEmail = String(inputs.contact_email || '')
  return `<div class="bx-addr">
    ${name ? `<div class="bx-addr-name">${esc(name)}</div>` : ''}
    ${address ? `<div class="bx-addr-line">${esc(address).replace(/\n/g, '<br/>')}</div>` : ''}
    ${contactName ? `<div class="bx-addr-line">Contact: ${esc(contactName)}</div>` : ''}
    ${contactEmail ? `<div class="bx-addr-line">Email: ${esc(contactEmail)}</div>` : ''}
  </div>`
}

function renderDeliveryAddress({ inputs }: RenderArg): string {
  const label = String(inputs.label || 'Delivery address')
  const address = String(inputs.address || '')
  const notes = inputs.notes ? String(inputs.notes) : ''
  return `<div class="bx-addr">
    <div class="bx-addr-label">${esc(label)}</div>
    ${address ? `<div class="bx-addr-line">${esc(address).replace(/\n/g, '<br/>')}</div>` : ''}
    ${notes ? `<div class="bx-addr-line">${esc(notes)}</div>` : ''}
  </div>`
}

function renderOrderMeta({ inputs }: RenderArg): string {
  const rows: Array<[string, string]> = []
  if (inputs.document_number) rows.push(['No.', String(inputs.document_number)])
  if (inputs.document_date)   rows.push(['Date', String(inputs.document_date)])
  if (inputs.customer_number) rows.push(['Customer No.', String(inputs.customer_number)])
  if (inputs.po_number)       rows.push(['PO No.', String(inputs.po_number)])
  if (inputs.page_label)      rows.push(['Page', String(inputs.page_label)])
  return `<table class="bx-meta">
    ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
  </table>`
}

function applyTransform(transform: string | undefined, value: unknown): string {
  const raw = value == null ? '' : String(value)
  if (!transform) return raw
  switch (transform) {
    case 'currency': {
      const n = parseFloat(raw)
      return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : raw
    }
    case 'currency_thb': {
      const n = parseFloat(raw)
      return Number.isFinite(n) ? n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : raw
    }
    case 'number': {
      const n = parseFloat(raw)
      return Number.isFinite(n) ? n.toLocaleString('en-US') : raw
    }
    case 'date':  return raw
    case 'upper': return raw.toUpperCase()
    case 'lower': return raw.toLowerCase()
    case 'title': return raw.replace(/\b\w/g, c => c.toUpperCase())
    default: return raw
  }
}

function renderLineItems({ block, inputs }: RenderArg): string {
  // resolveBlockInputs returns the raw array (the slot pointed at the
  // PuzzlePiece's line_items array). If the slot fell back to a string,
  // try to JSON-parse it as a courtesy.
  const rowsRaw = inputs.rows
  let rows: Array<Record<string, unknown>> = []
  if (Array.isArray(rowsRaw)) {
    rows = rowsRaw as Array<Record<string, unknown>>
  } else if (typeof rowsRaw === 'string' && rowsRaw.trim().startsWith('[')) {
    try { rows = JSON.parse(rowsRaw) } catch { rows = [] }
  }

  const cols = (block as LineItemsBlock).inputs.columns
  const zebra = (block as LineItemsBlock).inputs.zebra

  const header = cols.map(c => `<th class="bx-col bx-col--${esc(c.align || 'left')}" ${c.width_mm ? `style="width:${c.width_mm}mm"` : ''}>${esc(c.label)}</th>`).join('')
  const body = rows.map((row, i) => {
    const tds = cols.map(c => {
      let raw: unknown
      if (c.row_path === '@number') raw = i + 1
      else if (c.row_path === '@index') raw = i
      else raw = row[c.row_path]
      const v = applyTransform(c.transform, raw)
      return `<td class="bx-col bx-col--${esc(c.align || 'left')}">${esc(v)}</td>`
    }).join('')
    return `<tr class="bx-row${zebra && i % 2 ? ' bx-row--zebra' : ''}">${tds}</tr>`
  }).join('')

  return `<table class="bx-rows">
    <thead><tr>${header}</tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

function renderTotals({ inputs }: RenderArg): string {
  const rows = Array.isArray(inputs.rows) ? inputs.rows as Array<Record<string, unknown>> : []
  const currency = String(inputs.currency || '')
  const lines = rows.map(row => {
    const label = String(row.label || '')
    const value = applyTransform('currency', row.value)
    const cls = row.emphasised ? 'bx-tot-row bx-tot-row--strong' : 'bx-tot-row'
    return `<tr class="${cls}"><th>${esc(label)}</th><td>${esc(value)}${currency ? ` ${esc(currency)}` : ''}</td></tr>`
  }).join('')
  return `<table class="bx-totals">${lines}</table>`
}

function renderTerms({ inputs }: RenderArg): string {
  const title = String(inputs.title || '')
  const body = String(inputs.body || '')
  return `<div class="bx-terms">
    ${title ? `<div class="bx-terms-title">${esc(title)}</div>` : ''}
    <div class="bx-terms-body">${esc(body).replace(/\n/g, '<br/>')}</div>
  </div>`
}

function renderSignature({ inputs, opts }: RenderArg): string {
  const image = String(inputs.image || '')
  const printedName = String(inputs.printed_name || '')
  const title = inputs.title ? String(inputs.title) : ''
  const date = inputs.date ? String(inputs.date) : ''
  const src = image ? opts.resolveImage(image) : ''
  return `<div class="bx-sig">
    ${src ? `<img src="${esc(src)}" alt="Signature" class="bx-sig-img" />` : '<div class="bx-sig-line"></div>'}
    <div class="bx-sig-name">${esc(printedName)}</div>
    ${title ? `<div class="bx-sig-title">${esc(title)}</div>` : ''}
    ${date ? `<div class="bx-sig-date">${esc(date)}</div>` : ''}
  </div>`
}

function renderNote({ inputs }: RenderArg): string {
  const body = String(inputs.body || '')
  return `<div class="bx-note">${esc(body).replace(/\n/g, '<br/>')}</div>`
}

function renderText({ inputs }: RenderArg): string {
  const body = String(inputs.body || '')
  return `<div class="bx-text">${esc(body).replace(/\n/g, '<br/>')}</div>`
}

function renderImage({ inputs, opts }: RenderArg): string {
  const image = String(inputs.image || '')
  const alt = inputs.alt ? String(inputs.alt) : ''
  const fit = (inputs.fit as string) === 'cover' ? 'cover' : 'contain'
  const src = image ? opts.resolveImage(image) : ''
  if (!src) return ''
  return `<img src="${esc(src)}" alt="${esc(alt)}" style="width:100%;height:100%;object-fit:${fit}" />`
}

function renderDivider({ inputs }: RenderArg): string {
  const thick = inputs.thickness === 'thick'
  return `<hr class="bx-hr${thick ? ' bx-hr--thick' : ''}" />`
}

function renderSpacer(): string { return '' }

// ── Master switch ────────────────────────────────────────────────────────

const RENDERERS: Record<Block['type'], (a: RenderArg) => string> = {
  logo: renderLogo,
  sender_header: renderSenderHeader,
  recipient: renderRecipient,
  delivery_address: renderDeliveryAddress,
  order_meta: renderOrderMeta,
  line_items: renderLineItems,
  totals: renderTotals,
  terms: renderTerms,
  signature: renderSignature,
  note: renderNote,
  text: renderText,
  image: renderImage,
  divider: renderDivider,
  spacer: renderSpacer,
}

function renderBlock(block: Block, opts: SerializeOptions): string {
  const inputs = resolveBlockInputs(block, opts.ctx)
  const fn = RENDERERS[block.type]
  const inner = fn ? fn({ block, inputs, opts }) : ''
  return `<div class="bx-block bx-block--${block.type}" style="${layoutWrapperStyle(block.layout)}"${styleAttr(block.style)} data-block-id="${esc(block.id)}">${inner}</div>`
}

function renderPage(page: Page, doc: DocumentTree, opts: SerializeOptions): string {
  const dim = PAGE_DIMENSIONS_MM[doc.page_size]
  const blocks = page.block_ids
    .map(id => doc.blocks[id])
    .filter((b): b is Block => !!b)
    .map(b => renderBlock(b, opts))
    .join('\n')
  const watermark = opts.watermark ? `<div class="bx-watermark" aria-hidden="true">${esc(opts.watermark)}</div>` : ''
  return `<section class="bx-page" style="width:${dim.w}mm;height:${dim.h}mm;">${watermark}${blocks}</section>`
}

// ── Default stylesheet ───────────────────────────────────────────────────

const DEFAULT_CSS = `
@page { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #111; }
.bx-page { position: relative; page-break-after: always; background: #fff; }
.bx-page:last-child { page-break-after: auto; }
.bx-block { font-size: inherit; line-height: 1.4; }
.bx-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform: rotate(-30deg); font-size: 60pt; color: rgba(0,0,0,0.06); pointer-events: none; user-select: none; z-index: 0; }

.bx-logo { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 2mm; align-items: flex-start; }
.bx-caption { font-size: 9pt; color: #555; }

.bx-sender-name { font-weight: 700; font-size: 11pt; }
.bx-sender-line { font-size: 8.5pt; color: #555; line-height: 1.4; }

.bx-addr-name { font-weight: 700; }
.bx-addr-label { font-size: 9pt; color: #777; margin-bottom: 1mm; text-transform: uppercase; letter-spacing: 0.04em; }
.bx-addr-line { font-size: 9pt; color: #333; }

.bx-meta { width: 100%; border-collapse: collapse; }
.bx-meta th { text-align: left; font-weight: 600; padding: 0.5mm 2mm 0.5mm 0; color: #555; white-space: nowrap; }
.bx-meta td { padding: 0.5mm 0; }

.bx-rows { width: 100%; border-collapse: collapse; }
.bx-rows thead th { border-top: 0.5pt solid #999; border-bottom: 0.5pt solid #999; padding: 1.5mm 2mm; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #555; font-weight: 600; }
.bx-rows tbody td { padding: 1.5mm 2mm; border-bottom: 0.25pt solid #ddd; vertical-align: top; }
.bx-row--zebra { background: #f6f6f6; }
.bx-col--right { text-align: right; }
.bx-col--center { text-align: center; }

.bx-totals { margin-left: auto; border-collapse: collapse; }
.bx-totals th { text-align: left; padding: 1mm 6mm 1mm 0; color: #444; font-weight: 500; }
.bx-totals td { text-align: right; padding: 1mm 0; min-width: 30mm; }
.bx-tot-row--strong th, .bx-tot-row--strong td { font-weight: 700; border-top: 0.5pt solid #333; padding-top: 1.5mm; }

.bx-terms-title { font-weight: 600; margin-bottom: 1mm; }
.bx-terms-body { font-size: 9pt; color: #444; }

.bx-sig { display: flex; flex-direction: column; gap: 1mm; align-items: flex-end; }
.bx-sig-img { max-height: 60%; max-width: 100%; object-fit: contain; }
.bx-sig-line { width: 100%; height: 0; border-top: 0.5pt solid #333; }
.bx-sig-name { font-weight: 600; }
.bx-sig-title, .bx-sig-date { font-size: 9pt; color: #555; }

.bx-note { font-style: italic; color: #444; }
.bx-text { color: #222; line-height: 1.55; }
.bx-hr { border: none; border-top: 0.4pt solid #999; margin: 0; }
.bx-hr--thick { border-top-width: 1pt; border-color: #333; }
`

export function serializeDocument(doc: DocumentTree, opts: SerializeOptions): string {
  const styleTokens = doc.style_tokens
    ? Object.entries(doc.style_tokens).map(([k, v]) => `--${k}:${v};`).join('')
    : ''
  const tokenBlock = styleTokens ? `:root{${styleTokens}}` : ''
  const pages = doc.pages.map(p => renderPage(p, doc, opts)).join('\n')
  const css = `${tokenBlock}${DEFAULT_CSS}${opts.extra_css || ''}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${pages}</body></html>`
}
