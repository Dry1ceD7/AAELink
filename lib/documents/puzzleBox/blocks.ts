/**
 * Block-tree document model — the canonical Puzzle Box template format.
 *
 * A Document is a tree of typed blocks. The system recognises every block
 * (logo, address, line items, totals, terms, …), knows which inputs each
 * block accepts, and binds those inputs to data sources (client.*, custom.*,
 * assembly.*) via slots.  Because the template is structured data — not
 * opaque HTML — the editor can:
 *
 *   1. Surface every editable region as a draggable card.
 *   2. Swap a logo, address, or signature in one move when the client changes.
 *   3. Reorder blocks by dragging.
 *   4. Override any value per-document without touching the template.
 *
 * The render pipeline serialises the tree to HTML right before Stirling-PDF
 * picks it up. This is the only file in the module that defines the shape of
 * a template; everything else (editor, assemble stage, recognizer, override
 * layer) reads from these types.
 */

// ── Slots ────────────────────────────────────────────────────────────────

/**
 * Where a block input pulls its value from.
 *
 *   - `manual` — the literal string carried by the slot itself.
 *   - `client` — the bound client_profile (logo, address, contact, …).
 *   - `workspace` — workspace brand / sender info (your company).
 *   - `assembly` — the in-flight PuzzlePiece data (line items, custom fields).
 *   - `ticket` — the originating ticket (title, status, custom fields).
 *   - `user` — the user driving the assembly (name, email, signature).
 *   - `formula` — a small arithmetic expression over other slots
 *                 (e.g. `sum:assembly.line_items[].amount`).
 */
export type SlotSource =
  | 'manual'
  | 'client'
  | 'workspace'
  | 'assembly'
  | 'ticket'
  | 'user'
  | 'formula'

export interface Slot {
  /** Where to read from. */
  source: SlotSource
  /** Dot-path inside the source (`client.logo_bucket_key`, `assembly.fields.invoice_number`). Empty for `manual`. */
  path: string
  /** Default value used when the resolved value is missing or empty. */
  fallback: string
}

/** Helpers that the editor + the resolver agree on. */
export const slot = {
  manual:    (text: string): Slot => ({ source: 'manual',    path: '', fallback: text }),
  client:    (path: string, fallback = ''): Slot => ({ source: 'client',    path, fallback }),
  workspace: (path: string, fallback = ''): Slot => ({ source: 'workspace', path, fallback }),
  assembly:  (path: string, fallback = ''): Slot => ({ source: 'assembly',  path, fallback }),
  ticket:    (path: string, fallback = ''): Slot => ({ source: 'ticket',    path, fallback }),
  user:      (path: string, fallback = ''): Slot => ({ source: 'user',      path, fallback }),
  formula:   (expr: string, fallback = '0'): Slot => ({ source: 'formula',  path: expr, fallback }),
}

export function isSlot(v: unknown): v is Slot {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return typeof s.source === 'string' && typeof s.path === 'string' && typeof s.fallback === 'string'
}

// ── Block types ──────────────────────────────────────────────────────────

export type BlockType =
  | 'logo'
  | 'sender_header'
  | 'recipient'
  | 'delivery_address'
  | 'order_meta'
  | 'line_items'
  | 'totals'
  | 'terms'
  | 'signature'
  | 'note'
  | 'text'
  | 'image'
  | 'divider'
  | 'spacer'

/** Layout — page co-ordinates in millimetres so the renderer can convert
 *  to any PDF page size cleanly. (0,0) is top-left. */
export interface BlockLayout {
  page: number
  x_mm: number
  y_mm: number
  w_mm: number
  h_mm: number
}

/** Visual style — kept small on purpose. Anything bespoke goes via `text` block. */
export interface BlockStyle {
  align?: 'left' | 'center' | 'right' | 'justify'
  font_size_pt?: number
  font_weight?: 'normal' | 'bold'
  italic?: boolean
  color?: string             // CSS colour string
  background?: string        // CSS colour string
  border?: 'none' | 'thin' | 'thick'
  padding_mm?: number
}

/** All blocks share these fields. */
export interface BlockBase {
  id: string
  type: BlockType
  layout: BlockLayout
  style?: BlockStyle
  /** When true, end-users on a per-document override flow cannot remove this block. */
  locked?: boolean
  /** Free notes shown to template editors only. */
  designer_note?: string
}

// ── Concrete block shapes ────────────────────────────────────────────────

/** Logo image — typically the client's logo, but can be bound to workspace. */
export interface LogoBlock extends BlockBase {
  type: 'logo'
  inputs: {
    /** Slot resolving to a bucket key or absolute URL. Default: client.logo. */
    image: Slot
    /** Optional caption (e.g. company name) drawn under the logo. */
    caption?: Slot
    fit?: 'contain' | 'cover'
  }
}

/** Your company / sender header — name, address, tax id. */
export interface SenderHeaderBlock extends BlockBase {
  type: 'sender_header'
  inputs: {
    name: Slot
    address: Slot
    tax_id: Slot
    contact: Slot
  }
}

/** Recipient — pulls from the bound client by default. */
export interface RecipientBlock extends BlockBase {
  type: 'recipient'
  inputs: {
    name: Slot
    address: Slot
    contact_name: Slot
    contact_email: Slot
  }
}

/** Delivery / ship-to — independent of the recipient on purpose. */
export interface DeliveryAddressBlock extends BlockBase {
  type: 'delivery_address'
  inputs: {
    label: Slot
    address: Slot
    notes?: Slot
  }
}

/** Order/PO/invoice metadata block (number, date, terms reference). */
export interface OrderMetaBlock extends BlockBase {
  type: 'order_meta'
  inputs: {
    document_number: Slot
    document_date: Slot
    page_label?: Slot
    customer_number?: Slot
    po_number?: Slot
  }
}

/** Line-items table. Columns are user-defined and individually bindable. */
export interface LineItemsBlock extends BlockBase {
  type: 'line_items'
  inputs: {
    /** JSON array source: `assembly.line_items` is the default. */
    rows: Slot
    columns: Array<{
      key: string                // 'description' | 'qty' | 'unit_price' | 'amount' | 'pos' | …
      label: string              // Header label; supports localisation via locale_overrides
      /** Path inside each row; empty means render the index. */
      row_path: string
      align?: 'left' | 'center' | 'right'
      width_mm?: number
      transform?: 'currency' | 'currency_thb' | 'number' | 'date' | 'upper' | 'lower' | 'title'
    }>
    /** When true, render zebra striping. */
    zebra?: boolean
  }
}

/** Totals — subtotal / tax / grand total. Every row is a slot, often a formula. */
export interface TotalsBlock extends BlockBase {
  type: 'totals'
  inputs: {
    rows: Array<{
      key: string                // 'subtotal' | 'tax' | 'total' | …
      label: Slot
      value: Slot
      emphasised?: boolean
    }>
    currency: Slot
  }
}

/** Terms / payment / delivery clauses — typically multi-paragraph. */
export interface TermsBlock extends BlockBase {
  type: 'terms'
  inputs: {
    title: Slot
    body: Slot
  }
}

/** Signature block — image + printed name + label. */
export interface SignatureBlock extends BlockBase {
  type: 'signature'
  inputs: {
    image: Slot
    printed_name: Slot
    title?: Slot
    date?: Slot
  }
}

/** Free-text note (e.g. "Thank you for your order"). */
export interface NoteBlock extends BlockBase {
  type: 'note'
  inputs: { body: Slot }
}

/** Generic rich-text paragraph. */
export interface TextBlock extends BlockBase {
  type: 'text'
  inputs: { body: Slot }
}

/** Static / dynamic image (illustration, signature stamp, hero, …). */
export interface ImageBlock extends BlockBase {
  type: 'image'
  inputs: {
    image: Slot
    alt?: Slot
    fit?: 'contain' | 'cover'
  }
}

/** Horizontal rule. */
export interface DividerBlock extends BlockBase {
  type: 'divider'
  inputs: { thickness?: 'thin' | 'thick' }
}

/** Vertical spacer (height_mm in layout). */
export interface SpacerBlock extends BlockBase {
  type: 'spacer'
  inputs: Record<string, never>
}

export type Block =
  | LogoBlock
  | SenderHeaderBlock
  | RecipientBlock
  | DeliveryAddressBlock
  | OrderMetaBlock
  | LineItemsBlock
  | TotalsBlock
  | TermsBlock
  | SignatureBlock
  | NoteBlock
  | TextBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock

// ── Page + Document ──────────────────────────────────────────────────────

export interface Page {
  id: string
  /** Block ids in stack order (top → bottom). Layout drives final position. */
  block_ids: string[]
}

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5'

export const PAGE_DIMENSIONS_MM: Record<PageSize, { w: number; h: number }> = {
  A4:     { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
  Legal:  { w: 215.9, h: 355.6 },
  A3:     { w: 297, h: 420 },
  A5:     { w: 148, h: 210 },
}

export interface DocumentTree {
  schema_version: '2'
  page_size: PageSize
  /** Per-locale string overrides, keyed by `block_id.input_key`. */
  locale_overrides?: Record<string, Record<string, string>>
  /** Workspace-wide brand tokens that style blocks reference (`var(--brand-primary)`). */
  style_tokens?: Record<string, string>
  blocks: Record<string, Block>
  pages: Page[]
}

// ── Per-assembly overrides ───────────────────────────────────────────────

/**
 * When a single document is generated, the user may override individual
 * slot values *for that one output* without touching the template. The
 * resolver applies overrides on top of the template's slot bindings.
 *
 * Key: `<block_id>.<input_path>` — e.g. `terms-1.body`, `totals-1.rows[0].value`.
 * Value: a Slot (so a user can rebind to manual text, or to a different
 * source path).
 */
export type SlotOverrides = Record<string, Slot>

// ── Block library descriptor (palette + recogniser) ──────────────────────

export interface BlockSpec {
  type: BlockType
  display_name: string
  /** Lucide icon name; the editor maps this to the actual component. */
  icon: string
  /** Default size when dropped onto a page. */
  default_size_mm: { w: number; h: number }
  /** Factory for an empty block — used by the palette. */
  factory: (id: string, layout: BlockLayout) => Block
  /** Hint for the recognizer when proposing block boundaries from a sample. */
  recognizer_hints: {
    /** Rough aspect ratio (w/h). */
    aspect?: number
    /** Keywords that should appear inside the OCR text of the region. */
    keywords?: string[]
    /** Where the block typically lives on the page (top-left, top-right, …). */
    typical_anchor?: 'top-left' | 'top-right' | 'top-center' | 'middle' | 'bottom-left' | 'bottom-right' | 'bottom-center'
  }
}

const id = (s: string) => `${s}-${Math.random().toString(36).slice(2, 8)}`

export const BLOCK_LIBRARY: Record<BlockType, BlockSpec> = {
  logo: {
    type: 'logo',
    display_name: 'Logo',
    icon: 'image',
    default_size_mm: { w: 60, h: 25 },
    factory: (idOverride, layout): LogoBlock => ({
      id: idOverride || id('logo'),
      type: 'logo',
      layout,
      inputs: {
        image: slot.client('logo_bucket_key'),
        caption: slot.client('name'),
        fit: 'contain',
      },
    }),
    recognizer_hints: { aspect: 60 / 25, typical_anchor: 'top-left' },
  },
  sender_header: {
    type: 'sender_header',
    display_name: 'Sender header',
    icon: 'building-2',
    default_size_mm: { w: 100, h: 25 },
    factory: (idOverride, layout): SenderHeaderBlock => ({
      id: idOverride || id('sender'),
      type: 'sender_header',
      layout,
      inputs: {
        name: slot.workspace('name'),
        address: slot.workspace('address'),
        tax_id: slot.workspace('tax_id'),
        contact: slot.workspace('contact'),
      },
    }),
    recognizer_hints: { typical_anchor: 'top-center', keywords: ['head office', 'tax id'] },
  },
  recipient: {
    type: 'recipient',
    display_name: 'Recipient (Bill to)',
    icon: 'user',
    default_size_mm: { w: 90, h: 35 },
    factory: (idOverride, layout): RecipientBlock => ({
      id: idOverride || id('recipient'),
      type: 'recipient',
      layout,
      inputs: {
        name: slot.client('name'),
        address: slot.client('address'),
        contact_name: slot.client('contact_name'),
        contact_email: slot.client('email'),
      },
    }),
    recognizer_hints: { typical_anchor: 'top-left', keywords: ['bill to', 'invoice to', 'sold to'] },
  },
  delivery_address: {
    type: 'delivery_address',
    display_name: 'Delivery address (Ship to)',
    icon: 'truck',
    default_size_mm: { w: 90, h: 35 },
    factory: (idOverride, layout): DeliveryAddressBlock => ({
      id: idOverride || id('delivery'),
      type: 'delivery_address',
      layout,
      inputs: {
        label: slot.manual('Delivery address'),
        address: slot.assembly('fields.delivery_address', ''),
      },
    }),
    recognizer_hints: { typical_anchor: 'top-left', keywords: ['delivery address', 'ship to', 'shipping address'] },
  },
  order_meta: {
    type: 'order_meta',
    display_name: 'Order / Invoice meta',
    icon: 'tag',
    default_size_mm: { w: 90, h: 35 },
    factory: (idOverride, layout): OrderMetaBlock => ({
      id: idOverride || id('meta'),
      type: 'order_meta',
      layout,
      inputs: {
        document_number: slot.assembly('fields.invoice_number'),
        document_date: slot.assembly('fields.issue_date'),
        page_label: slot.manual('Page 1/1'),
        customer_number: slot.assembly('fields.customer_number'),
        po_number: slot.assembly('fields.po_number'),
      },
    }),
    recognizer_hints: { typical_anchor: 'top-right', keywords: ['order confirmation', 'invoice', 'quote', 'no.'] },
  },
  line_items: {
    type: 'line_items',
    display_name: 'Line items',
    icon: 'table',
    default_size_mm: { w: 190, h: 80 },
    factory: (idOverride, layout): LineItemsBlock => ({
      id: idOverride || id('rows'),
      type: 'line_items',
      layout,
      inputs: {
        rows: slot.assembly('line_items'),
        columns: [
          { key: 'pos',         label: 'Pos',  row_path: '@number',     align: 'left',   width_mm: 12 },
          { key: 'description', label: 'Article description', row_path: 'description', align: 'left' },
          { key: 'qty',         label: 'Qty',  row_path: 'qty',         align: 'right',  width_mm: 22 },
          { key: 'unit_price',  label: 'Unit price', row_path: 'unit_price', align: 'right', width_mm: 26, transform: 'currency' },
          { key: 'amount',      label: 'Total', row_path: 'amount',     align: 'right',  width_mm: 26, transform: 'currency' },
        ],
        zebra: false,
      },
    }),
    recognizer_hints: { keywords: ['pos', 'article description', 'qty', 'unit price', 'total'], typical_anchor: 'middle' },
  },
  totals: {
    type: 'totals',
    display_name: 'Totals',
    icon: 'sigma',
    default_size_mm: { w: 90, h: 30 },
    factory: (idOverride, layout): TotalsBlock => ({
      id: idOverride || id('totals'),
      type: 'totals',
      layout,
      inputs: {
        rows: [
          { key: 'subtotal', label: slot.manual('Sub-total'), value: slot.formula('sum:assembly.line_items[].amount') },
          { key: 'tax',      label: slot.manual('Tax-free'),  value: slot.manual('') },
          { key: 'total',    label: slot.manual('Total'),     value: slot.formula('sum:assembly.line_items[].amount'), emphasised: true },
        ],
        currency: slot.assembly('fields.currency', 'USD'),
      },
    }),
    recognizer_hints: { keywords: ['sub-total', 'subtotal', 'total', 'tax'], typical_anchor: 'bottom-right' },
  },
  terms: {
    type: 'terms',
    display_name: 'Terms / Payment',
    icon: 'file-text',
    default_size_mm: { w: 190, h: 25 },
    factory: (idOverride, layout): TermsBlock => ({
      id: idOverride || id('terms'),
      type: 'terms',
      layout,
      inputs: {
        title: slot.manual('Terms'),
        body: slot.client('legal_boilerplate', 'Standard terms apply.'),
      },
    }),
    recognizer_hints: { keywords: ['delivery terms', 'shipment by', 'payment terms', 'cif', 'fob', 'bank transfer'], typical_anchor: 'bottom-left' },
  },
  signature: {
    type: 'signature',
    display_name: 'Signature',
    icon: 'pen',
    default_size_mm: { w: 70, h: 30 },
    factory: (idOverride, layout): SignatureBlock => ({
      id: idOverride || id('sign'),
      type: 'signature',
      layout,
      inputs: {
        image: slot.user('signature_image_key'),
        printed_name: slot.user('first_name'),
        title: slot.user('job_title'),
        date: slot.assembly('fields.signed_at'),
      },
    }),
    recognizer_hints: { typical_anchor: 'bottom-right' },
  },
  note: {
    type: 'note',
    display_name: 'Note',
    icon: 'sticky-note',
    default_size_mm: { w: 190, h: 12 },
    factory: (idOverride, layout): NoteBlock => ({
      id: idOverride || id('note'),
      type: 'note',
      layout,
      inputs: { body: slot.manual('Thank you for your order.') },
    }),
    recognizer_hints: { keywords: ['thank you', 'best regards', 'sincerely'], typical_anchor: 'bottom-center' },
  },
  text: {
    type: 'text',
    display_name: 'Text',
    icon: 'type',
    default_size_mm: { w: 190, h: 20 },
    factory: (idOverride, layout): TextBlock => ({
      id: idOverride || id('text'),
      type: 'text',
      layout,
      inputs: { body: slot.manual('') },
    }),
    recognizer_hints: {},
  },
  image: {
    type: 'image',
    display_name: 'Image',
    icon: 'image',
    default_size_mm: { w: 60, h: 40 },
    factory: (idOverride, layout): ImageBlock => ({
      id: idOverride || id('image'),
      type: 'image',
      layout,
      inputs: {
        image: slot.manual(''),
        alt: slot.manual(''),
        fit: 'contain',
      },
    }),
    recognizer_hints: {},
  },
  divider: {
    type: 'divider',
    display_name: 'Divider',
    icon: 'minus',
    default_size_mm: { w: 190, h: 1 },
    factory: (idOverride, layout): DividerBlock => ({
      id: idOverride || id('div'),
      type: 'divider',
      layout,
      inputs: { thickness: 'thin' },
    }),
    recognizer_hints: {},
  },
  spacer: {
    type: 'spacer',
    display_name: 'Spacer',
    icon: 'rows',
    default_size_mm: { w: 190, h: 8 },
    factory: (idOverride, layout): SpacerBlock => ({
      id: idOverride || id('spacer'),
      type: 'spacer',
      layout,
      inputs: {},
    }),
    recognizer_hints: {},
  },
}

// ── Tree validation ──────────────────────────────────────────────────────

export interface TreeValidationIssue {
  code:
    | 'unknown_block_type'
    | 'page_block_missing'
    | 'duplicate_block_id'
    | 'orphan_block'
    | 'invalid_layout'
    | 'invalid_slot'
    | 'overflow'
  block_id?: string
  page?: number
  message: string
}

export function validateDocument(doc: DocumentTree): TreeValidationIssue[] {
  const issues: TreeValidationIssue[] = []

  if (doc.schema_version !== '2') {
    issues.push({ code: 'invalid_layout', message: `Unsupported schema_version: ${String((doc as unknown as { schema_version: unknown }).schema_version)}` })
  }

  const seenIds = new Set<string>()
  const referenced = new Set<string>()

  for (const [blockId, block] of Object.entries(doc.blocks)) {
    if (block.id !== blockId) {
      issues.push({ code: 'invalid_layout', block_id: blockId, message: `Map key ${blockId} ≠ block.id ${block.id}` })
    }
    if (seenIds.has(blockId)) {
      issues.push({ code: 'duplicate_block_id', block_id: blockId, message: `Block id ${blockId} appears more than once` })
    }
    seenIds.add(blockId)

    if (!BLOCK_LIBRARY[block.type]) {
      issues.push({ code: 'unknown_block_type', block_id: blockId, message: `Unknown block type ${block.type}` })
    }

    const { layout } = block
    if (!Number.isFinite(layout.x_mm) || !Number.isFinite(layout.y_mm) ||
        !Number.isFinite(layout.w_mm) || !Number.isFinite(layout.h_mm)) {
      issues.push({ code: 'invalid_layout', block_id: blockId, message: 'Layout must be finite numbers (mm)' })
    }
    if (layout.w_mm <= 0 || layout.h_mm <= 0) {
      issues.push({ code: 'invalid_layout', block_id: blockId, message: 'Layout must have positive width and height' })
    }

    const dim = PAGE_DIMENSIONS_MM[doc.page_size]
    if (layout.x_mm < 0 || layout.y_mm < 0 ||
        layout.x_mm + layout.w_mm > dim.w + 0.5 ||
        layout.y_mm + layout.h_mm > dim.h + 0.5) {
      issues.push({ code: 'overflow', block_id: blockId, message: `Block ${blockId} overflows page bounds for ${doc.page_size}` })
    }
  }

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i]
    for (const blockId of page.block_ids) {
      if (!doc.blocks[blockId]) {
        issues.push({ code: 'page_block_missing', page: i + 1, block_id: blockId, message: `Page ${i + 1} references missing block ${blockId}` })
      } else {
        referenced.add(blockId)
      }
    }
  }

  for (const blockId of Object.keys(doc.blocks)) {
    if (!referenced.has(blockId)) {
      issues.push({ code: 'orphan_block', block_id: blockId, message: `Block ${blockId} not referenced by any page` })
    }
  }

  return issues
}

// ── Empty document factory ───────────────────────────────────────────────

let _seq = 0
export function newBlockId(prefix: string): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`
}

export function emptyDocument(pageSize: PageSize = 'A4'): DocumentTree {
  return {
    schema_version: '2',
    page_size: pageSize,
    blocks: {},
    pages: [{ id: newBlockId('page'), block_ids: [] }],
  }
}
