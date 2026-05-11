import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Dialog API — Slack dialog.open parity.
 *
 * POST /api/dialog — open interactive dialogs (legacy — prefer views/modals)
 *
 * Legacy Slack dialog support for backward compatibility.
 * New integrations should use /api/views instead.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    trigger_id?: string
    dialog?: {
      callback_id?: string; title?: string; submit_label?: string
      elements?: Array<{
        type: string; name: string; label: string
        placeholder?: string; optional?: boolean; value?: string
        options?: Array<{ label: string; value: string }>
      }>
    }
  }

  if (!body.trigger_id || !body.dialog) {
    return NextResponse.json({ ok: false, error: 'trigger_id and dialog required' }, { status: 400 })
  }

  // Validate dialog elements
  const elements = body.dialog.elements || []
  if (elements.length > 10) {
    return NextResponse.json({ ok: false, error: 'max 10 elements per dialog' }, { status: 400 })
  }

  for (const el of elements) {
    if (!el.name || !el.label) {
      return NextResponse.json({ ok: false, error: 'each element needs name and label' }, { status: 400 })
    }
    if (!['text', 'textarea', 'select'].includes(el.type)) {
      return NextResponse.json({ ok: false, error: `invalid element type: ${el.type}` }, { status: 400 })
    }
  }

  return NextResponse.json({
    ok: true,
    dialog: {
      callback_id: body.dialog.callback_id || '',
      title: body.dialog.title || '',
      submit_label: body.dialog.submit_label || 'Submit',
      elements: elements,
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/dialog', _POST)
