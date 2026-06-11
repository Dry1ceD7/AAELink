import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  createUploadSession,
  getUploadSession,
  UploadSessionError,
} from '@/lib/files/uploadSessions'

/**
 * Resumable upload sessions — Slack files.getUploadURLExternal parity.
 *
 * POST /api/files/upload-sessions          — create a session (returns part_size + id)
 * GET  /api/files/upload-sessions?session_id= — owner status, for resume
 *
 * The PUT (append part) + POST [id] (complete/abort) live under [id]/route.ts.
 * Logic is in lib/files/uploadSessions; these handlers stay thin.
 */

/** Map an UploadSessionError to a snake_case JSON error response. */
function errorResponse(err: unknown): NextResponse {
  if (err instanceof UploadSessionError) {
    return NextResponse.json({ error: err.code, ...(err.extra || {}) }, { status: err.status })
  }
  throw err
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    filename?: string
    content_type?: string
    size?: number
    channel_id?: string
  }

  try {
    const session = await createUploadSession(pool, {
      uid,
      filename: String(body.filename || ''),
      contentType: body.content_type,
      declaredSize: Number(body.size),
      channelId: body.channel_id ?? null,
    })

    writeAuditLog({
      pool,
      workspaceId: session.workspace_id ?? undefined,
      actorId: uid,
      action: 'file.upload_session.create',
      resourceKind: 'upload_session',
      resourceId: session.id,
      ipAddress: extractIp(req),
      metadata: {
        filename: session.filename,
        declared_size: Number(session.declared_size),
        backend: session.backend,
        channel_id: session.channel_id,
      },
    })

    return NextResponse.json({
      session: {
        id: session.id,
        part_size: session.part_size,
        expires_at: Number(session.expires_at),
        parts_received: session.parts_received,
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sessionId = req.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return NextResponse.json({ error: 'session_id_required' }, { status: 400 })

  const session = await getUploadSession(pool, sessionId)
  if (!session) return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  // Owner-only — the resume token is the session id; non-owners get 403, never
  // a leaked status (which would expose filename/size of another user's upload).
  if (session.user_id !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json({
    id: session.id,
    status: session.status,
    part_size: session.part_size,
    declared_size: Number(session.declared_size),
    received_bytes: Number(session.received_bytes),
    parts_received: session.parts_received,
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET',  '/api/files/upload-sessions', _GET)
export const POST = tracedRoute('POST', '/api/files/upload-sessions', _POST)
