import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { addItemComment, listItemComments, deleteItemComment } from '@/lib/lists/itemThreads'

/**
 * List item threads (D6).
 *
 * GET    /api/lists/items/:itemId/comments — list the item's thread
 * POST   /api/lists/items/:itemId/comments — add a comment   Body: { body }
 * DELETE /api/lists/items/:itemId/comments — delete a comment Body: { comment_id }
 */
type Ctx = { params: Promise<{ itemId: string }> }

const ERR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  empty_body: 400,
}

async function _GET(_req: NextRequest, ctx: Ctx) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { itemId } = await ctx.params

  const result = await listItemComments(pool, uid, itemId)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR_STATUS[result.code] ?? 400 })
  return NextResponse.json({ comments: result.comments, total: result.comments.length })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { itemId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { body?: string }
  const result = await addItemComment(pool, uid, itemId, String(body.body || ''))
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR_STATUS[result.code] ?? 400 })
  return NextResponse.json({ ok: true, comment: result.comment }, { status: 201 })
}

async function _DELETE(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ctx.params // itemId not needed; comment is addressed by id

  const body = (await req.json().catch(() => ({}))) as { comment_id?: string }
  const commentId = String(body.comment_id || '').trim()
  if (!commentId) return NextResponse.json({ error: 'comment_id_required' }, { status: 400 })

  const result = await deleteItemComment(pool, uid, commentId)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR_STATUS[result.code] ?? 400 })
  return NextResponse.json({ ok: true, comment_id: result.commentId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/lists/items/:itemId/comments', _GET)
export const POST   = tracedRoute('POST', '/api/lists/items/:itemId/comments', _POST)
export const DELETE = tracedRoute('DELETE', '/api/lists/items/:itemId/comments', _DELETE)
