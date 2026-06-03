import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { addKeyword, removeKeyword, listKeywords } from '@/lib/notifications/keywords'

/**
 * Keyword notifications (D11).
 *
 * GET    /api/notifications/keywords — list the caller's keywords
 * POST   /api/notifications/keywords — add a keyword   Body: { keyword }
 * DELETE /api/notifications/keywords — remove a keyword Body: { keyword }
 *
 * Personal to the caller; mutations are CSRF-protected, no audit.
 */
const ADD_ERROR_STATUS: Record<string, number> = { invalid: 400, too_long: 400, limit_reached: 409 }

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const keywords = await listKeywords(pool, uid)
  return NextResponse.json({ keywords, total: keywords.length })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { keyword?: string }
  const result = await addKeyword(pool, uid, String(body.keyword || ''))
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ADD_ERROR_STATUS[result.code] ?? 400 })
  return NextResponse.json({ ok: true, keyword: result.keyword }, { status: 201 })
}

async function _DELETE(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { keyword?: string }
  const keyword = String(body.keyword || '').trim()
  if (!keyword) return NextResponse.json({ error: 'keyword_required' }, { status: 400 })

  const removed = await removeKeyword(pool, uid, keyword)
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/notifications/keywords', _GET)
export const POST   = tracedRoute('POST', '/api/notifications/keywords', _POST)
export const DELETE = tracedRoute('DELETE', '/api/notifications/keywords', _DELETE)
