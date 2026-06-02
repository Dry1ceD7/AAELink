// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Clips API — short video/audio recordings attached to channels/DMs.
 *
 * GET  /api/messages/clips — list clips in a channel or for a user
 * POST /api/messages/clips — create a clip record (after file upload)
 *
 * Clip types:
 *   - video    — screen recording, camera, or combo
 *   - audio    — voice note
 *   - screen   — screen-only recording
 *
 * Features:
 *   - Auto-generated transcript (when transcription worker processes it)
 *   - Thumbnail preview generation
 *   - Duration limits (configurable via admin)
 *   - Channel or DM scope
 *   - Thread replies support
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const mine = req.nextUrl.searchParams.get('mine') === 'true'
  const type = req.nextUrl.searchParams.get('type') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 25, 50)

  let where = 'WHERE 1=1'
  const params: (string | number)[] = []

  if (channelId) { params.push(channelId); where += ` AND cl.channel_id = $${params.length}` }
  if (mine) { params.push(uid); where += ` AND cl.created_by = $${params.length}` }
  if (['video', 'audio', 'screen'].includes(type)) {
    params.push(type); where += ` AND cl.clip_type = $${params.length}`
  }
  params.push(limit)

  const { rows } = await pool.query<{
    id: string; channel_id: string; thread_id: string; clip_type: string;
    title: string; file_id: string; file_url: string;
    duration_seconds: number; file_size: number; thumbnail_url: string;
    mime_type: string; transcript: string; transcript_status: string;
    views: number; created_by: string; created_at: number; author: string;
  }>(`
    SELECT cl.*, u.username AS author
    FROM aaelink.clips cl
    LEFT JOIN aaelink.users u ON u.id = cl.created_by
    ${where}
    ORDER BY cl.created_at DESC
    LIMIT $${params.length}
  `, params)

  return NextResponse.json({
    clips: rows.map(r => ({
      ...r,
      duration_seconds: Number(r.duration_seconds || 0),
      file_size: Number(r.file_size || 0),
      created_at: Number(r.created_at),
      views: Number(r.views || 0),
    })),
    total: rows.length,
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string; thread_id?: string
    clip_type?: string; title?: string
    file_id?: string; file_url?: string
    duration_seconds?: number; file_size?: number
    thumbnail_url?: string; mime_type?: string
    transcript?: string
  }

  const fileId = String(body.file_id || '').trim()
  if (!fileId) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  const clipType = ['video', 'audio', 'screen'].includes(body.clip_type || '')
    ? body.clip_type! : 'video'

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.clips
      (id, channel_id, thread_id, clip_type, title,
       file_id, file_url, duration_seconds, file_size,
       thumbnail_url, mime_type, transcript, transcript_status,
       views, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15)
  `, [
    id, body.channel_id || null, body.thread_id || null,
    clipType, body.title || 'Untitled Clip',
    fileId, body.file_url || '', body.duration_seconds || 0,
    body.file_size || 0, body.thumbnail_url || '',
    body.mime_type || 'video/webm',
    body.transcript || '',
    body.transcript ? 'complete' : 'pending',
    uid, now
  ])

  // Enqueue transcription job if no transcript
  if (!body.transcript) {
    await pool.query(`
      INSERT INTO aaelink.jobs
        (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
      VALUES ($1, 'compliance_export', 'pending', 5, $2, $3, 3, 0, $4, $3)
    `, [randomUUID(), JSON.stringify({ clip_id: id, file_id: fileId, action: 'transcribe' }), now, uid])
  }

  return NextResponse.json({
    clip: { id, clip_type: clipType, duration_seconds: body.duration_seconds || 0, created_at: now }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/messages/clips', _GET)
export const POST   = tracedRoute('POST', '/api/messages/clips', _POST)
