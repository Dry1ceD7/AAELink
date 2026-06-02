import { reactionSummariesForMessages, rowToPost } from '@/lib/messaging/chat-post'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { startScheduledMessageProcessor } from '@/lib/infra/scheduledMessageProcessor'
import { tracedRoute } from '@/lib/api/tracedRoute'

// Start the scheduled message delivery processor on module load
startScheduledMessageProcessor()

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function initialWatermark(
  pool: NonNullable<ReturnType<typeof getPool>>,
  channelId: string,
  sinceParam: string | null
): Promise<number> {
  if (sinceParam !== null && sinceParam !== '') {
    const s = Number(sinceParam)
    if (Number.isFinite(s) && s > 0) return s
  }
  const { rows } = await pool.query<{ m: string; d: string }>(
    `SELECT
       (SELECT COALESCE(MAX(created_at), 0)::text FROM aaelink.messages
        WHERE channel_id = $1 AND (root_id IS NULL OR root_id = '')) AS m,
       (SELECT COALESCE(MAX(deleted_at), 0)::text FROM aaelink.message_deletions
        WHERE channel_id = $1) AS d`,
    [channelId]
  )
  return Math.max(Number(rows[0]?.m || 0), Number(rows[0]?.d || 0))
}

/** Start past existing thread replies so we only stream deltas for new activity. */
async function initialThreadReplyWatermark(
  pool: NonNullable<ReturnType<typeof getPool>>,
  channelId: string,
  sinceParam: string | null
): Promise<number> {
  if (sinceParam !== null && sinceParam !== '') {
    const s = Number(sinceParam)
    if (Number.isFinite(s) && s > 0) return s
  }
  const { rows } = await pool.query<{ m: string }>(
    `SELECT COALESCE(MAX(created_at), 0)::text AS m FROM aaelink.messages
     WHERE channel_id = $1 AND root_id IS NOT NULL AND root_id <> ''`,
    [channelId]
  )
  return Number(rows[0]?.m || 0)
}

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return new Response('database_not_configured', { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return new Response('unauthorized', { status: 401 })
  await ensureSchema()
  const url = new URL(req.url)
  const channelId = String(url.searchParams.get('channel_id') || '')
  if (!channelId) return new Response('channel_id_required', { status: 400 })
  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return new Response('forbidden', { status: 403 })
  }
  let watermarkMs = await initialWatermark(pool, channelId, url.searchParams.get('since'))
  let threadReplyWatermarkMs = await initialThreadReplyWatermark(pool, channelId, url.searchParams.get('since'))

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let stopped = false
      let ticks = 0
      let inFlight = false
      let timer: ReturnType<typeof setInterval> | null = null

      const stop = () => {
        stopped = true
        if (timer) {
          clearInterval(timer)
          timer = null
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      const tick = async () => {
        if (stopped || req.signal.aborted || inFlight) return
        inFlight = true
        try {
          const payload: {
            posts?: unknown[]
            reply_counts?: Record<string, number>
            deletions?: { id: string; deleted_at: number; thread_root_id?: string }[]
          } = {}
          const collabW0 = watermarkMs

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
            `SELECT m.id, m.channel_id, m.user_id, m.body AS message, m.created_at AS create_at, m.updated_at, m.root_id,
                    (SELECT COUNT(*)::int FROM aaelink.messages r WHERE r.channel_id = m.channel_id AND r.root_id = m.id) AS reply_count
             FROM aaelink.messages m
             WHERE m.channel_id = $1 AND (m.root_id IS NULL OR m.root_id = '')
               AND (m.created_at > $2 OR m.updated_at > $2)
             ORDER BY GREATEST(m.created_at, m.updated_at) ASC LIMIT 100`,
            [channelId, collabW0]
          )
          if (rows.length > 0) {
            const rx = await reactionSummariesForMessages(
              pool,
              uid,
              rows.map(r => r.id)
            )
            const posts = rows.map(r =>
              rowToPost(
                {
                  id: r.id,
                  channel_id: r.channel_id,
                  user_id: r.user_id,
                  message: r.message,
                  create_at: r.create_at,
                  updated_at: r.updated_at,
                  root_id: r.root_id,
                  reply_count: r.reply_count
                },
                rx.get(r.id)
              )
            )
            for (const r of rows) {
              const c = Number(r.create_at)
              const u = Number(r.updated_at)
              watermarkMs = Math.max(watermarkMs, c, Number.isFinite(u) ? u : c)
            }
            payload.posts = posts
          }

          const { rows: countRows } = await pool.query<{ id: string; reply_count: string }>(
            `WITH touched AS (
               SELECT DISTINCT root_id AS id
               FROM aaelink.messages
               WHERE channel_id = $1 AND root_id <> '' AND root_id IS NOT NULL
                 AND (created_at > $2 OR updated_at > $2)
             )
             SELECT t.id,
               (SELECT COUNT(*)::int FROM aaelink.messages c WHERE c.channel_id = $1 AND c.root_id = t.id) AS reply_count
             FROM touched t`,
            [channelId, threadReplyWatermarkMs]
          )
          if (countRows.length > 0) {
            const reply_counts: Record<string, number> = {}
            for (const r of countRows) {
              reply_counts[r.id] = Number(r.reply_count) || 0
            }
            payload.reply_counts = reply_counts
          }

          const { rows: delRows } = await pool.query<{
            message_id: string
            deleted_at: string
            thread_root_id: string
          }>(
            `SELECT message_id, deleted_at, thread_root_id FROM aaelink.message_deletions
             WHERE channel_id = $1 AND deleted_at > $2
             ORDER BY deleted_at ASC LIMIT 200`,
            [channelId, collabW0]
          )
          if (delRows.length > 0) {
            payload.deletions = delRows.map(d => {
              const tr = String(d.thread_root_id || '').trim()
              return {
                id: d.message_id,
                deleted_at: Number(d.deleted_at) || 0,
                ...(tr ? { thread_root_id: tr } : {})
              }
            })
            for (const d of delRows) {
              const t = Number(d.deleted_at)
              if (Number.isFinite(t)) watermarkMs = Math.max(watermarkMs, t)
            }
            const rootIds = [
              ...new Set(
                delRows
                  .map(d => String(d.thread_root_id || '').trim())
                  .filter(id => id.length > 0)
              )
            ]
            if (rootIds.length > 0) {
              const reply_counts = { ...(payload.reply_counts ?? {}) }
              for (const rid of rootIds) {
                const { rows: cr } = await pool.query<{ c: string }>(
                  `SELECT COUNT(*)::int AS c FROM aaelink.messages
                   WHERE channel_id = $1 AND root_id = $2`,
                  [channelId, rid]
                )
                reply_counts[rid] = Number(cr[0]?.c) || 0
              }
              payload.reply_counts = reply_counts
            }
          }

          const { rows: twRows } = await pool.query<{ m: string | null }>(
            `SELECT MAX(GREATEST(m.created_at, m.updated_at))::text AS m
             FROM aaelink.messages m
             WHERE m.channel_id = $1 AND m.root_id <> '' AND m.root_id IS NOT NULL
               AND (m.created_at > $2 OR m.updated_at > $2)`,
            [channelId, threadReplyWatermarkMs]
          )
          const twNext = twRows[0]?.m
          if (twNext != null && twNext !== '') {
            const n = Number(twNext)
            if (Number.isFinite(n) && n > threadReplyWatermarkMs) threadReplyWatermarkMs = n
          }

          if (
            (payload.posts && payload.posts.length > 0) ||
            (payload.reply_counts && Object.keys(payload.reply_counts).length > 0) ||
            (payload.deletions && payload.deletions.length > 0)
          ) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`))
          }
          ticks += 1
          if (ticks % 10 === 0) {
            controller.enqueue(enc.encode(': ping\n\n'))
          }
        } catch {
          /* keep stream alive on transient DB errors */
        } finally {
          inFlight = false
        }
      }

      req.signal.addEventListener('abort', stop)

      void tick()
      timer = setInterval(() => void tick(), 2000)
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/collab/events', _GET)
