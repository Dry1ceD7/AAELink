import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { postSignal, fetchSignals, listRoomParticipants } from '@/lib/calls/signaling'

/**
 * WebRTC signaling relay (D5).
 *
 * GET  /api/calls/:roomId/signals?after=<seq> — poll signals for the caller +
 *      the active participant list (peer discovery)
 * POST /api/calls/:roomId/signals — relay a signal
 *      Body: { to_user?, kind: 'offer'|'answer'|'ice'|'bye', payload }
 *
 * Only active participants of an active room may poll or post.
 */
type Ctx = { params: Promise<{ roomId: string }> }

const SIGNAL_ERROR_STATUS: Record<string, number> = {
  room_not_active: 404,
  not_participant: 403,
  invalid_kind: 400,
}

async function _GET(req: NextRequest, ctx: Ctx) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { roomId } = await ctx.params

  const after = Number(req.nextUrl.searchParams.get('after')) || 0
  const result = await fetchSignals(pool, roomId, uid, after)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: SIGNAL_ERROR_STATUS[result.code] ?? 400 })

  const participants = await listRoomParticipants(pool, roomId)
  return NextResponse.json({ signals: result.signals, cursor: result.cursor, participants })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { roomId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { to_user?: string; kind?: string; payload?: unknown }
  const kind = String(body.kind || '').trim()
  if (!kind) return NextResponse.json({ error: 'kind_required' }, { status: 400 })

  const result = await postSignal(pool, roomId, uid, String(body.to_user || ''), kind, body.payload)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: SIGNAL_ERROR_STATUS[result.code] ?? 400 })

  return NextResponse.json({ ok: true, seq: result.seq, id: result.id }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET', '/api/calls/:roomId/signals', _GET)
export const POST = tracedRoute('POST', '/api/calls/:roomId/signals', _POST)
