import { NextResponse } from 'next/server'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { reactionSummariesForMessages, rowToPost } from '@/lib/messaging/chat-post'
import { recordMessageEdit } from '@/lib/messaging/messageEdits'
import { applyDlpToMessage } from '@/lib/enterprise/dlpInterceptor'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { emitMessageDeleted } from '@/lib/webhooks/webhookEmitter'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

const MAX_BODY = 32_000

/** Resolve any message in a thread to its root post for deep links (notifications, shared links). */
async function _GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: messageId } = await ctx.params
  if (!messageId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })

  const { rows } = await pool.query<{
    workspace_id: string
    channel_id: string
    id: string
    user_id: string
    message: string
    create_at: string
    updated_at: string
    root_id: string
    reply_count: string | null
    focus_reply_id: string | null
  }>(
    `WITH target AS (
       SELECT m.id AS requested_id,
              m.channel_id,
              m.root_id,
              CASE
                WHEN COALESCE(NULLIF(TRIM(m.root_id), ''), '') = '' THEN NULL::text
                ELSE m.id::text
              END AS focus_reply_id
       FROM aaelink.messages m WHERE m.id = $1
     ),
     rid AS (
       SELECT t.channel_id,
              CASE
                WHEN COALESCE(NULLIF(TRIM(t.root_id), ''), '') = '' THEN t.requested_id
                ELSE TRIM(t.root_id)
              END AS thread_root_id,
              t.focus_reply_id
       FROM target t
     )
     SELECT c.workspace_id,
            m.channel_id,
            m.id,
            m.user_id,
            m.body AS message,
            m.created_at AS create_at,
            m.updated_at,
            m.root_id,
            (SELECT COUNT(*)::int FROM aaelink.messages r WHERE r.channel_id = m.channel_id AND r.root_id = m.id) AS reply_count,
            rid.focus_reply_id
     FROM rid
     JOIN aaelink.channels c ON c.id = rid.channel_id
     JOIN aaelink.messages m ON m.id = rid.thread_root_id AND m.channel_id = rid.channel_id`,
    [messageId]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await userCanReadChannel(pool, uid, row.channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const rx = await reactionSummariesForMessages(pool, uid, [row.id])
  const post = rowToPost(
    {
      id: row.id,
      channel_id: row.channel_id,
      user_id: row.user_id,
      message: row.message,
      create_at: row.create_at,
      updated_at: row.updated_at,
      root_id: row.root_id,
      reply_count: row.reply_count
    },
    rx.get(row.id)
  )
  return NextResponse.json({
    workspace_id: row.workspace_id,
    post,
    focus_reply_id: row.focus_reply_id || null
  })
}

async function _PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: messageId } = await ctx.params
  if (!messageId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })

  const body = (await req.json()) as { message?: string }
  const message = String(body.message ?? '').trim()
  if (!message) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  if (message.length > MAX_BODY) {
    return NextResponse.json({ error: 'message_too_long' }, { status: 400 })
  }

  const found = await pool.query<{ channel_id: string; user_id: string; body: string }>(
    `SELECT channel_id, user_id, body FROM aaelink.messages WHERE id = $1`,
    [messageId]
  )
  const row = found.rows[0]
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (row.user_id !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!(await userCanReadChannel(pool, uid, row.channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const previousBody = row.body

  // DLP check on the new content before persisting the edit.
  const dlp = await applyDlpToMessage({ content: message, userId: uid, channelId: row.channel_id })
  if (!dlp.allowed) return NextResponse.json({ error: 'dlp_blocked' }, { status: 403 })
  const safeMessage = dlp.content

  const now = Date.now()
  const { rows } = await pool.query<{
    id: string
    channel_id: string
    user_id: string
    message: string
    create_at: string
    updated_at: string
    root_id: string
    reply_count: string | null
  }>(
    `WITH u AS (
       UPDATE aaelink.messages SET body = $2, updated_at = $3 WHERE id = $1 AND user_id = $4
       RETURNING id, channel_id, user_id, body AS message, created_at AS create_at, updated_at, root_id
     )
     SELECT u.*,
            (SELECT COUNT(*)::int FROM aaelink.messages r WHERE r.channel_id = u.channel_id AND r.root_id = u.id) AS reply_count
     FROM u`,
    [messageId, safeMessage, now, uid]
  )
  const u = rows[0]
  if (!u) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Capture the pre-edit body for the message's edit history (D3).
  if (previousBody !== safeMessage) {
    await recordMessageEdit(pool, {
      messageId,
      channelId: row.channel_id,
      editorId: uid,
      previousBody,
      editedAt: now,
    }).catch(() => { /* history is best-effort, never blocks the edit */ })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'message.edit',
    resourceKind: 'message',
    resourceId: messageId,
    metadata: { channel_id: row.channel_id },
  })

  const rx = await reactionSummariesForMessages(pool, uid, [u.id])
  const post = rowToPost(
    {
      id: u.id,
      channel_id: u.channel_id,
      user_id: u.user_id,
      message: u.message,
      create_at: u.create_at,
      updated_at: u.updated_at,
      root_id: u.root_id,
      reply_count: u.reply_count
    },
    rx.get(u.id)
  )
  return NextResponse.json({ ...post, reactions: post.reactions ?? [] })
}

/** Owner-only delete. Root posts remove all thread replies in this channel. */
async function _DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: messageId } = await ctx.params
  if (!messageId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })

  const peek = await pool.query<{ channel_id: string; user_id: string; root_id: string }>(
    `SELECT channel_id, user_id, root_id FROM aaelink.messages WHERE id = $1`,
    [messageId]
  )
  const peekRow = peek.rows[0]
  if (!peekRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (peekRow.user_id !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!(await userCanReadChannel(pool, uid, peekRow.channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<{ channel_id: string; user_id: string; root_id: string }>(
      `SELECT channel_id, user_id, root_id FROM aaelink.messages WHERE id = $1 FOR UPDATE`,
      [messageId]
    )
    const row = found.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (row.user_id !== uid) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const now = Date.now()
    const isRoot = String(row.root_id || '') === ''

    const { rows: doomed } = await client.query<{ id: string }>(
      isRoot
        ? `SELECT id FROM aaelink.messages WHERE id = $1 OR root_id = $1`
        : `SELECT id FROM aaelink.messages WHERE id = $1`,
      [messageId]
    )
    const deletedIds = doomed.map(r => r.id)
    const threadRootForEvent = isRoot ? messageId : String(row.root_id)
    for (const id of deletedIds) {
      await client.query(
        `INSERT INTO aaelink.message_deletions (message_id, channel_id, deleted_at, thread_root_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (message_id) DO NOTHING`,
        [id, row.channel_id, now, threadRootForEvent]
      )
    }

    if (isRoot) {
      await client.query(`DELETE FROM aaelink.messages WHERE root_id = $1`, [messageId])
      await client.query(`DELETE FROM aaelink.messages WHERE id = $1`, [messageId])
    } else {
      await client.query(`DELETE FROM aaelink.messages WHERE id = $1`, [messageId])
    }

    await client.query('COMMIT')
    writeAuditLog({
      pool,
      actorId: uid,
      action: 'message.delete',
      resourceKind: 'message',
      resourceId: messageId,
      metadata: { channel_id: row.channel_id, deleted_ids: deletedIds },
    })
    try {
      await emitMessageDeleted(pool, { channel_id: row.channel_id, message_id: messageId, user_id: uid })
    } catch (e) { console.error('emitMessageDeleted', e) }
    return NextResponse.json({ deleted_ids: deletedIds, deleted_at: now })
  } catch {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  } finally {
    client.release()
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/messages/:id', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/messages/:id', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/messages/:id', _DELETE)
