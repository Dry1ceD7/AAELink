import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  saveItem,
  unsaveItem,
  setSavedItemState,
  listSavedItems,
} from '@/lib/messaging/savedItems'

/**
 * Saved / "Later" items (D3).
 *
 * GET    /api/saved-items[?state=] — list the caller's saved items
 * POST   /api/saved-items           — save a message    Body: { message_id, note? }
 * PATCH  /api/saved-items           — change item state  Body: { message_id, state }
 * DELETE /api/saved-items           — unsave a message   Body: { message_id }
 *
 * Personal to the caller, so no audit log; mutations are CSRF-protected.
 */

const SAVE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_state: 400,
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const state = req.nextUrl.searchParams.get('state') || undefined
  const items = await listSavedItems(pool, uid, state)
  return NextResponse.json({ items, total: items.length })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { message_id?: string; note?: string }
  const messageId = String(body.message_id || '').trim()
  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })

  const result = await saveItem(pool, uid, messageId, String(body.note || ''))
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: SAVE_ERROR_STATUS[result.code] ?? 400 })
  return NextResponse.json({ ok: true, message_id: result.messageId }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { message_id?: string; state?: string }
  const messageId = String(body.message_id || '').trim()
  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })

  const result = await setSavedItemState(pool, uid, messageId, String(body.state || ''))
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: SAVE_ERROR_STATUS[result.code] ?? 400 })
  return NextResponse.json({ ok: true, message_id: result.messageId, state: result.state })
}

async function _DELETE(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { message_id?: string }
  const messageId = String(body.message_id || '').trim()
  if (!messageId) return NextResponse.json({ error: 'message_id_required' }, { status: 400 })

  const removed = await unsaveItem(pool, uid, messageId)
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, message_id: messageId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/saved-items', _GET)
export const POST   = tracedRoute('POST', '/api/saved-items', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/saved-items', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/saved-items', _DELETE)
