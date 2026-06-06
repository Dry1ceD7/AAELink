import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  appendPart,
  completeUploadSession,
  abortUploadSession,
  UploadSessionError,
} from '@/lib/files/uploadSessions'

/**
 * Resumable upload session part upload + finalize.
 *
 * PUT  /api/files/upload-sessions/[id]?part=N — append one part. The body is the
 *      RAW part bytes (req.arrayBuffer()), NOT multipart form data. part is the
 *      1-based part number.
 * POST /api/files/upload-sessions/[id]        — body { action: 'complete' | 'abort' }.
 *
 * Logic lives in lib/files/uploadSessions; handlers stay thin. CSRF on both.
 */

function errorResponse(err: unknown): NextResponse {
  if (err instanceof UploadSessionError) {
    return NextResponse.json({ error: err.code, ...(err.extra || {}) }, { status: err.status })
  }
  throw err
}

async function _PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  // Parse from req.url (works on both Request and NextRequest — nextUrl is
  // NextRequest-only and absent when a handler is invoked with a plain Request).
  const partRaw = new URL(req.url).searchParams.get('part') || ''
  const partNumber = Number(partRaw)
  // Reject NaN / empty up front; appendPart re-validates the [1, total] range
  // and integer-ness against the session's part math.
  if (!partRaw || !Number.isFinite(partNumber)) {
    return NextResponse.json({ error: 'invalid_part_number' }, { status: 400 })
  }

  const bytes = Buffer.from(await req.arrayBuffer())

  try {
    const result = await appendPart(pool, { sessionId: id, partNumber, bytes, uid })
    return NextResponse.json({
      part_number: partNumber,
      received_bytes: result.received_bytes,
      parts_received: result.parts_received,
      duplicate: result.duplicate,
    })
  } catch (err) {
    return errorResponse(err)
  }
}

async function _POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { action?: string }
  const action = String(body.action || '')

  try {
    if (action === 'complete') {
      const result = await completeUploadSession(pool, { sessionId: id, uid })
      return NextResponse.json(result)
    }
    if (action === 'abort') {
      await abortUploadSession(pool, { sessionId: id, uid, reason: 'user_abort' })
      // Audit handled inside abortUploadSession; record the ip-bearing actor
      // here too so the http.* audit trail carries the request context.
      writeAuditLog({
        pool,
        actorId: uid,
        action: 'file.upload_session.abort.request',
        resourceKind: 'upload_session',
        resourceId: id,
        ipAddress: extractIp(req),
      })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  } catch (err) {
    return errorResponse(err)
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const PUT  = tracedRoute('PUT',  '/api/files/upload-sessions/:id', _PUT)
export const POST = tracedRoute('POST', '/api/files/upload-sessions/:id', _POST)
