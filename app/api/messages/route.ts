import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { NextResponse } from 'next/server'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { reactionSummariesForMessages, rowToPost } from '@/lib/messaging/chat-post'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { notifyChannelMentions, notifyDirectMessage } from '@/lib/notifications/notificationsServer'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

function authorLabel(row: { username: string; nickname: string; first_name: string; last_name: string }) {
  const full = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  if (full) return full
  if (row.nickname) return row.nickname
  return row.username
}

const ROOT_FILTER = `(m.root_id IS NULL OR m.root_id = '')`

type DeletionRow = { id: string; deleted_at: number; thread_root_id?: string }

async function deletionsSince(
  pool: Pool,
  channelId: string,
  since: number,
  threadRootId?: string
): Promise<DeletionRow[]> {
  const { rows } = await pool.query<{
    message_id: string
    deleted_at: string
    thread_root_id: string
  }>(
    threadRootId
      ? `SELECT message_id, deleted_at, thread_root_id FROM aaelink.message_deletions
         WHERE channel_id = $1 AND deleted_at > $2
           AND (thread_root_id = $3 OR message_id = $3)
         ORDER BY deleted_at ASC LIMIT 200`
      : `SELECT message_id, deleted_at, thread_root_id FROM aaelink.message_deletions
         WHERE channel_id = $1 AND deleted_at > $2
         ORDER BY deleted_at ASC LIMIT 200`,
    threadRootId ? [channelId, since, threadRootId] : [channelId, since]
  )
  return rows.map(r => {
    const tr = String(r.thread_root_id || '').trim()
    return {
      id: r.message_id,
      deleted_at: Number(r.deleted_at) || 0,
      ...(tr ? { thread_root_id: tr } : {})
    }
  })
}

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const channel_id = String(url.searchParams.get('channel_id') || '')
  const threadRootId = String(url.searchParams.get('root_id') || '').trim()
  if (!channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  await ensureSchema()
  if (!(await userCanReadChannel(pool, uid, channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const sinceRaw = url.searchParams.get('since')
  const useSince = sinceRaw !== null && sinceRaw !== ''
  const since = useSince ? Number(sinceRaw) : NaN
  const useIncremental = useSince && Number.isFinite(since)

  const beforeCreatedRaw = url.searchParams.get('before_created_at')
  const beforeId = String(url.searchParams.get('before_id') || '').trim()
  const beforeTs =
    beforeCreatedRaw != null && beforeCreatedRaw !== '' ? Number(beforeCreatedRaw) : Number.NaN
  const useBeforePagination = Number.isFinite(beforeTs) && beforeId.length > 0 && !useIncremental
  const OLDER_PAGE = 50
  /** Default window sizes (must match LIMITs below) for `older_available` hint. */
  const MAIN_TIMELINE_WINDOW = 300
  const THREAD_REPLIES_WINDOW = 200

  const aroundId = String(url.searchParams.get('around_id') || '').trim()
  const AR_BEFORE = 160
  const AR_AFTER = 160

  if (aroundId && !threadRootId && !useIncremental) {
    const anchor = await pool.query<{ anchor_ts: string }>(
      `SELECT r.created_at AS anchor_ts
       FROM aaelink.messages m
       JOIN aaelink.messages r
         ON r.channel_id = m.channel_id
        AND r.id = CASE
          WHEN COALESCE(NULLIF(TRIM(m.root_id), ''), '') = '' THEN m.id
          ELSE TRIM(m.root_id)
        END
       WHERE m.channel_id = $1 AND m.id = $2`,
      [channel_id, aroundId]
    )
    if (anchor.rows.length === 0) {
      return NextResponse.json({ error: 'message_not_found' }, { status: 404 })
    }
    const anchorTs = anchor.rows[0].anchor_ts
    const replySubAround = `(SELECT COUNT(*)::int FROM aaelink.messages r2 WHERE r2.channel_id = m.channel_id AND r2.root_id = m.id)`
    const { rows: beforeRows } = await pool.query<{
      id: string
      channel_id: string
      user_id: string
      message: string
      create_at: string
      updated_at: string
      root_id: string
      reply_count: string
    }>(
      `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id,
              COALESCE(m.type, '') AS type,
              ${replySubAround} AS reply_count
       FROM aaelink.messages m
       WHERE m.channel_id = $1 AND ${ROOT_FILTER} AND m.created_at <= $2::bigint
       ORDER BY m.created_at DESC
       LIMIT ${AR_BEFORE}`,
      [channel_id, anchorTs]
    )
    const { rows: afterRows } = await pool.query<{
      id: string
      channel_id: string
      user_id: string
      message: string
      create_at: string
      updated_at: string
      root_id: string
      reply_count: string
    }>(
      `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id,
              COALESCE(m.type, '') AS type,
              ${replySubAround} AS reply_count
       FROM aaelink.messages m
       WHERE m.channel_id = $1 AND ${ROOT_FILTER} AND m.created_at > $2::bigint
       ORDER BY m.created_at ASC
       LIMIT ${AR_AFTER}`,
      [channel_id, anchorTs]
    )
    const rows = [...beforeRows].reverse().concat(afterRows)
    const rx = await reactionSummariesForMessages(
      pool,
      uid,
      rows.map(r => r.id)
    )
    const posts = rows.map(r => rowToPost(r, rx.get(r.id)))
    let older_available = false
    if (rows.length > 0) {
      const oldest = rows[0]
      const { rows: exr } = await pool.query<{ ex: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM aaelink.messages m
           WHERE m.channel_id = $1 AND ${ROOT_FILTER}
             AND (m.created_at < $2::bigint OR (m.created_at = $2::bigint AND m.id < $3::text))
         ) AS ex`,
        [channel_id, oldest.create_at, oldest.id]
      )
      older_available = Boolean(exr[0]?.ex)
    }
    return NextResponse.json({ posts, older_available })
  }

  if (threadRootId) {
    const parent = await pool.query<{ id: string; root_id: string }>(
      `SELECT id, root_id FROM aaelink.messages WHERE id = $1 AND channel_id = $2`,
      [threadRootId, channel_id]
    )
    const p = parent.rows[0]
    if (!p) return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })
    if (String(p.root_id || '') !== '') {
      return NextResponse.json({ error: 'invalid_thread_root' }, { status: 400 })
    }

    const TR_BEFORE = 120
    const TR_AFTER = 120

    if (aroundId && !useIncremental) {
      const anchor = await pool.query<{ anchor_ts: string }>(
        `SELECT m.created_at AS anchor_ts
         FROM aaelink.messages m
         WHERE m.channel_id = $1 AND m.id = $2 AND TRIM(COALESCE(m.root_id, '')) = $3`,
        [channel_id, aroundId, threadRootId]
      )
      if (anchor.rows.length > 0) {
        const anchorTs = anchor.rows[0].anchor_ts
        const { rows: beforeRows } = await pool.query<{
          id: string
          channel_id: string
          user_id: string
          message: string
          create_at: string
          updated_at: string
          root_id: string
        }>(
          `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id
           FROM aaelink.messages m
           WHERE m.channel_id = $1 AND m.root_id = $2 AND m.created_at <= $3::bigint
           ORDER BY m.created_at DESC
           LIMIT ${TR_BEFORE}`,
          [channel_id, threadRootId, anchorTs]
        )
        const { rows: afterRows } = await pool.query<{
          id: string
          channel_id: string
          user_id: string
          message: string
          create_at: string
          updated_at: string
          root_id: string
        }>(
          `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id
           FROM aaelink.messages m
           WHERE m.channel_id = $1 AND m.root_id = $2 AND m.created_at > $3::bigint
           ORDER BY m.created_at ASC
           LIMIT ${TR_AFTER}`,
          [channel_id, threadRootId, anchorTs]
        )
        const rows = [...beforeRows].reverse().concat(afterRows)
        const rx = await reactionSummariesForMessages(
          pool,
          uid,
          rows.map(r => r.id)
        )
        const posts = rows.map(r => rowToPost(r, rx.get(r.id)))
        let older_available = false
        if (rows.length > 0) {
          const oldest = rows[0]
          const { rows: exr } = await pool.query<{ ex: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM aaelink.messages m
               WHERE m.channel_id = $1 AND m.root_id = $2
                 AND (m.created_at < $3::bigint OR (m.created_at = $3::bigint AND m.id < $4::text))
             ) AS ex`,
            [channel_id, threadRootId, oldest.create_at, oldest.id]
          )
          older_available = Boolean(exr[0]?.ex)
        }
        return NextResponse.json({ posts, older_available })
      }
    }

    if (useBeforePagination && !aroundId) {
      const { rows: oldRows } = await pool.query<{
        id: string
        channel_id: string
        user_id: string
        message: string
        create_at: string
        updated_at: string
        root_id: string
      }>(
        `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id
         FROM aaelink.messages m
         WHERE m.channel_id = $1 AND m.root_id = $2
           AND (m.created_at < $3::bigint OR (m.created_at = $3::bigint AND m.id < $4::text))
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ${OLDER_PAGE}`,
        [channel_id, threadRootId, beforeTs, beforeId]
      )
      const ordered = [...oldRows].reverse()
      const rx = await reactionSummariesForMessages(
        pool,
        uid,
        ordered.map(r => r.id)
      )
      const posts = ordered.map(r => rowToPost(r, rx.get(r.id)))
      return NextResponse.json({ posts, has_more: oldRows.length === OLDER_PAGE })
    }

    const { rows } = await pool.query<{
      id: string
      channel_id: string
      user_id: string
      message: string
      create_at: string
      updated_at: string
      root_id: string
    }>(
      useIncremental
        ? `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id
           FROM aaelink.messages m
           WHERE m.channel_id = $1 AND m.root_id = $2 AND (m.created_at > $3 OR m.updated_at > $3)
           ORDER BY GREATEST(m.created_at, m.updated_at) ASC LIMIT 200`
        : `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id
           FROM aaelink.messages m
           WHERE m.channel_id = $1 AND m.root_id = $2
           ORDER BY m.created_at ASC LIMIT ${THREAD_REPLIES_WINDOW}`,
      useIncremental ? [channel_id, threadRootId, since] : [channel_id, threadRootId]
    )
    const rx = await reactionSummariesForMessages(
      pool,
      uid,
      rows.map(r => r.id)
    )
    const posts = rows.map(r => rowToPost(r, rx.get(r.id)))
    if (useIncremental) {
      const deletions = await deletionsSince(pool, channel_id, since, threadRootId)
      if (deletions.length === 0) {
        return NextResponse.json({ posts })
      }
      const { rows: crr } = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::int AS c FROM aaelink.messages WHERE channel_id = $1 AND root_id = $2`,
        [channel_id, threadRootId]
      )
      const thread_reply_count = Number(crr[0]?.c) || 0
      return NextResponse.json({
        posts,
        deletions,
        thread_reply_count
      })
    }
    let older_available = false
    if (rows.length > 0 && rows.length === THREAD_REPLIES_WINDOW) {
      const oldest = rows[0]
      const { rows: exr } = await pool.query<{ ex: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM aaelink.messages m
           WHERE m.channel_id = $1 AND m.root_id = $2
             AND (m.created_at < $3::bigint OR (m.created_at = $3::bigint AND m.id < $4::text))
         ) AS ex`,
        [channel_id, threadRootId, oldest.create_at, oldest.id]
      )
      older_available = Boolean(exr[0]?.ex)
    }
    return NextResponse.json({ posts, older_available })
  }

  if (useBeforePagination && !aroundId) {
    const replySubOlder = `(SELECT COUNT(*)::int FROM aaelink.messages r WHERE r.channel_id = m.channel_id AND r.root_id = m.id)`
    const { rows: oldRows } = await pool.query<{
      id: string
      channel_id: string
      user_id: string
      message: string
      create_at: string
      updated_at: string
      root_id: string
      reply_count: string
    }>(
      `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id,
              COALESCE(m.type, '') AS type,
              ${replySubOlder} AS reply_count
       FROM aaelink.messages m
       WHERE m.channel_id = $1 AND ${ROOT_FILTER}
         AND (m.created_at < $2::bigint OR (m.created_at = $2::bigint AND m.id < $3::text))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${OLDER_PAGE}`,
      [channel_id, beforeTs, beforeId]
    )
    const ordered = [...oldRows].reverse()
    const rx = await reactionSummariesForMessages(
      pool,
      uid,
      ordered.map(r => r.id)
    )
    const posts = ordered.map(r => rowToPost(r, rx.get(r.id)))
    return NextResponse.json({ posts, has_more: oldRows.length === OLDER_PAGE })
  }

  const replySub = `(SELECT COUNT(*)::int FROM aaelink.messages r WHERE r.channel_id = m.channel_id AND r.root_id = m.id)`

  const { rows } = await pool.query<{
    id: string
    channel_id: string
    user_id: string
    message: string
    create_at: string
    updated_at: string
    root_id: string
    reply_count: string
  }>(
    useIncremental
      ? `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id,
                COALESCE(m.type, '') AS type,
                ${replySub} AS reply_count
         FROM aaelink.messages m
         WHERE m.channel_id = $1 AND ${ROOT_FILTER} AND (m.created_at > $2 OR m.updated_at > $2)
         ORDER BY GREATEST(m.created_at, m.updated_at) ASC LIMIT 200`
      : `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id,
                COALESCE(m.type, '') AS type,
                ${replySub} AS reply_count
         FROM aaelink.messages m
         WHERE m.channel_id = $1 AND ${ROOT_FILTER}
         ORDER BY m.created_at DESC LIMIT ${MAIN_TIMELINE_WINDOW}`,
    useIncremental ? [channel_id, since] : [channel_id]
  )

  const ordered = useIncremental ? rows : [...rows].reverse()
  const rx = await reactionSummariesForMessages(
    pool,
    uid,
    ordered.map(r => r.id)
  )
  const posts = ordered.map(r => rowToPost(r, rx.get(r.id)))
  if (useIncremental) {
    const deletions = await deletionsSince(pool, channel_id, since)
    const rootIds = [
      ...new Set(
        deletions.map(d => String(d.thread_root_id || '').trim()).filter(id => id.length > 0)
      )
    ]
    let reply_counts: Record<string, number> | undefined
    if (rootIds.length > 0) {
      reply_counts = {}
      for (const rid of rootIds) {
        const { rows: cr } = await pool.query<{ c: string }>(
          `SELECT COUNT(*)::int AS c FROM aaelink.messages WHERE channel_id = $1 AND root_id = $2`,
          [channel_id, rid]
        )
        reply_counts[rid] = Number(cr[0]?.c) || 0
      }
    }
    return NextResponse.json({
      posts,
      ...(deletions.length ? { deletions } : {}),
      ...(reply_counts ? { reply_counts } : {})
    })
  }
  let older_available = false
  if (ordered.length > 0 && ordered.length === MAIN_TIMELINE_WINDOW) {
    const oldest = ordered[0]
    const { rows: exr } = await pool.query<{ ex: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM aaelink.messages m
         WHERE m.channel_id = $1 AND ${ROOT_FILTER}
           AND (m.created_at < $2::bigint OR (m.created_at = $2::bigint AND m.id < $3::text))
       ) AS ex`,
      [channel_id, oldest.create_at, oldest.id]
    )
    older_available = Boolean(exr[0]?.ex)
  }
  return NextResponse.json({ posts, older_available })
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as { channel_id?: string; message?: string; root_id?: string; broadcast?: boolean }
  const channel_id = String(body.channel_id || '')
  const message = String(body.message || '').trim()
  const root_id = String(body.root_id || '').trim()
  if (!channel_id || !message) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  if (!(await userCanReadChannel(pool, uid, channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (root_id) {
    const pr = await pool.query<{ id: string; channel_id: string; root_id: string }>(
      `SELECT id, channel_id, root_id FROM aaelink.messages WHERE id = $1`,
      [root_id]
    )
    const parent = pr.rows[0]
    if (!parent || parent.channel_id !== channel_id) {
      return NextResponse.json({ error: 'invalid_thread_parent' }, { status: 400 })
    }
    if (String(parent.root_id || '') !== '') {
      return NextResponse.json({ error: 'thread_one_level_only' }, { status: 400 })
    }
  }

  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, channel_id, uid, message, root_id, now]
  )

  try {
    const { rows: chRows } = await pool.query<{
      workspace_id: string
      display_name: string
      name: string
      type: string
    }>(`SELECT workspace_id, display_name, name, type FROM aaelink.channels WHERE id = $1`, [channel_id])
    const ch = chRows[0]
    const { rows: uRows } = await pool.query<{
      username: string
      nickname: string
      first_name: string
      last_name: string
    }>(`SELECT username, nickname, first_name, last_name FROM aaelink.users WHERE id = $1`, [uid])
    const ur = uRows[0]
    if (ch?.workspace_id && ur) {
      const isDm = ch.type === 'D' || ch.type === 'G'
      if (isDm) {
        // DMs/group-DMs notify (and push) every recipient, not just @mentions.
        await notifyDirectMessage({
          pool,
          workspaceId: ch.workspace_id,
          channelId: channel_id,
          messageId: id,
          authorId: uid,
          authorLabel: authorLabel(ur),
          body: message
        })
      } else {
        const labelBase = (ch.display_name || ch.name || 'channel').trim()
        await notifyChannelMentions({
          pool,
          workspaceId: ch.workspace_id,
          channelId: channel_id,
          channelLabel: `#${labelBase}`,
          messageId: id,
          authorId: uid,
          authorLabel: authorLabel(ur),
          body: message
        })
      }
    }
  } catch (e) {
    console.error('notifyChannelMentions', e)
  }

  // ── Broadcast: also send as top-level message in the channel (Slack parity) ──
  if (root_id && body.broadcast) {
    const broadcastId = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [broadcastId, channel_id, uid, message, '', now + 1]
    )
  }

  const created = rowToPost({
    id,
    channel_id,
    user_id: uid,
    message,
    create_at: now,
    updated_at: now,
    root_id,
    reply_count: root_id ? undefined : 0
  })
  return NextResponse.json({ ...created, reactions: created.reactions ?? [] })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET',  '/api/messages', _GET)
export const POST = tracedRoute('POST', '/api/messages', _POST)
