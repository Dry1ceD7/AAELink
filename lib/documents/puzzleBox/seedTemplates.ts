/**
 * Seed templates — first-class block trees that demonstrate the puzzle
 * model. Each one mirrors a real document the team uses (Order Confirmation,
 * Quote, Invoice). Importing any one of these gives a workspace something
 * to swap clients into immediately.
 *
 * Layout numbers (mm) come from the Order Confirmation in the project
 * reference photo (logo top-left, sender header centre, recipient + delivery
 * stacked top-left, order meta top-right, line items table mid-page,
 * totals + terms bottom).
 */

import {
  BLOCK_LIBRARY, slot, type DocumentTree, newBlockId,
} from './blocks'

export interface SeedTemplate {
  kind: string
  name: string
  description: string
  page_size: 'A4'
  required_fields: string[]
  block_tree: DocumentTree
  style_tokens: Record<string, string>
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    kind: 'order_confirmation',
    name: 'Order Confirmation — AAE default',
    description: 'Mirrors the Advanced ID Asia Engineering order confirmation: logo, sender header, bill-to, ship-to, order meta, line items, totals, terms, signature.',
    page_size: 'A4',
    required_fields: ['invoice_number', 'issue_date'],
    style_tokens: {
      'brand-primary': '#003D6E',
      'brand-accent': '#4895EF',
    },
    block_tree: (() => {
      const doc: DocumentTree = {
        schema_version: '2',
        page_size: 'A4',
        blocks: {},
        pages: [{ id: newBlockId('page'), block_ids: [] }],
        style_tokens: {},
      }

      const logo = BLOCK_LIBRARY.logo.factory(
        'logo-aae',
        { page: 1, x_mm: 12, y_mm: 12, w_mm: 60, h_mm: 22 }
      )
      // Default to the workspace logo, fall back to the client logo.
      if (logo.type === 'logo') {
        logo.inputs.image = slot.workspace('logo_bucket_key', '')
        logo.inputs.caption = slot.manual('')
      }

      const sender = BLOCK_LIBRARY.sender_header.factory(
        'sender-aae',
        { page: 1, x_mm: 76, y_mm: 12, w_mm: 122, h_mm: 22 }
      )
      if (sender.type === 'sender_header') {
        sender.inputs.name = slot.workspace('name', 'Advanced ID Asia Engineering Co., Ltd')
        sender.inputs.address = slot.workspace('address', '116 Moo 3 T.Maekhue · A.Doisaket · Chiang Mai 50220 · Thailand')
        sender.inputs.tax_id = slot.workspace('tax_id', '0505548005683')
        sender.inputs.contact = slot.workspace('contact', '+66 53 387316-7 · info@advancedidasia.com')
      }

      const recipient = BLOCK_LIBRARY.recipient.factory(
        'recipient-1',
        { page: 1, x_mm: 12, y_mm: 42, w_mm: 90, h_mm: 38 }
      )

      const orderMeta = BLOCK_LIBRARY.order_meta.factory(
        'meta-1',
        { page: 1, x_mm: 110, y_mm: 42, w_mm: 88, h_mm: 38 }
      )
      if (orderMeta.type === 'order_meta') {
        orderMeta.inputs.document_number = slot.assembly('fields.invoice_number', 'S 00000')
        orderMeta.inputs.document_date = slot.assembly('fields.issue_date', '')
        orderMeta.inputs.customer_number = slot.assembly('fields.customer_number', '')
        orderMeta.inputs.po_number = slot.assembly('fields.po_number', '')
        orderMeta.inputs.page_label = slot.manual('Page 1/1')
      }

      const delivery = BLOCK_LIBRARY.delivery_address.factory(
        'delivery-1',
        { page: 1, x_mm: 12, y_mm: 86, w_mm: 90, h_mm: 36 }
      )
      if (delivery.type === 'delivery_address') {
        delivery.inputs.label = slot.manual('Delivery address')
        delivery.inputs.address = slot.assembly('fields.delivery_address', '')
      }

      const lineItems = BLOCK_LIBRARY.line_items.factory(
        'rows-1',
        { page: 1, x_mm: 12, y_mm: 130, w_mm: 186, h_mm: 100 }
      )
      // The factory already wires sensible columns. Customise widths/labels
      // to match the reference doc.
      if (lineItems.type === 'line_items') {
        lineItems.inputs.columns = [
          { key: 'pos',         label: 'Pos',                  row_path: '@number',     align: 'left',  width_mm: 12 },
          { key: 'description', label: 'Article description',  row_path: 'description', align: 'left' },
          { key: 'qty',         label: 'Quantity',             row_path: 'qty',         align: 'right', width_mm: 24 },
          { key: 'unit_price',  label: 'Unit price',           row_path: 'unit_price',  align: 'right', width_mm: 26, transform: 'currency' },
          { key: 'amount',      label: 'Total',                row_path: 'amount',      align: 'right', width_mm: 26, transform: 'currency' },
        ]
      }

      const totals = BLOCK_LIBRARY.totals.factory(
        'totals-1',
        { page: 1, x_mm: 110, y_mm: 234, w_mm: 88, h_mm: 28 }
      )
      if (totals.type === 'totals') {
        totals.inputs.rows = [
          { key: 'subtotal', label: slot.manual('Sub-total'), value: slot.formula('sum:assembly.line_items[].amount') },
          { key: 'tax',      label: slot.manual('Tax-free'),  value: slot.manual('') },
          { key: 'total',    label: slot.manual('Total'),     value: slot.formula('sum:assembly.line_items[].amount'), emphasised: true },
        ]
        totals.inputs.currency = slot.assembly('fields.currency', 'USD')
      }

      const terms = BLOCK_LIBRARY.terms.factory(
        'terms-1',
        { page: 1, x_mm: 12, y_mm: 234, w_mm: 92, h_mm: 28 }
      )
      if (terms.type === 'terms') {
        terms.inputs.title = slot.manual('Delivery & payment terms')
        terms.inputs.body = slot.assembly(
          'fields.terms',
          'Delivery terms: CIF\nShipment by: Standard\nPayment terms: Bank transfer\n30 days after shipment.'
        )
      }

      const note = BLOCK_LIBRARY.note.factory(
        'note-1',
        { page: 1, x_mm: 12, y_mm: 266, w_mm: 186, h_mm: 10 }
      )
      if (note.type === 'note') {
        note.inputs.body = slot.manual('Thank you for your order.')
      }

      const signature = BLOCK_LIBRARY.signature.factory(
        'sig-1',
        { page: 1, x_mm: 130, y_mm: 266, w_mm: 70, h_mm: 24 }
      )
      if (signature.type === 'signature') {
        signature.inputs.image = slot.user('signature_image_key', '')
        signature.inputs.printed_name = slot.user('first_name', '')
        signature.inputs.title = slot.user('job_title', '')
        signature.inputs.date = slot.assembly('fields.signed_at', '')
      }

      const blocks = [logo, sender, recipient, orderMeta, delivery, lineItems, totals, terms, note, signature]
      for (const b of blocks) {
        doc.blocks[b.id] = b
        doc.pages[0].block_ids.push(b.id)
      }
      return doc
    })(),
  },
]

export function findSeedTemplateByKind(kind: string): SeedTemplate | null {
  return SEED_TEMPLATES.find(t => t.kind === kind) || null
}
