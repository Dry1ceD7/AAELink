import type { ApiNotification } from '@/lib/notificationTypes'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return new Response('database_not_configured', { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return new Response('unauthorized', { status: 401 })
  await ensureSchema()

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let stopped = false
      let inFlight = false
      let timer: ReturnType<typeof setInterval> | null = null
      let ticks = 0
      let prevMaxCreated = 0
      let prevUnread = -1
      let primed = false

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
          const { rows: mxRows } = await pool.query<{ m: string }>(
            `SELECT COALESCE(MAX(created_at), 0)::text AS m FROM aaelink.notifications WHERE user_id = $1`,
            [uid]
          )
          const maxCreated = Number(mxRows[0]?.m) || 0
          const { rows: cRows } = await pool.query<{ c: string }>(
            `SELECT COUNT(*)::int AS c FROM aaelink.notifications WHERE user_id = $1 AND read_at = 0`,
            [uid]
          )
          const unread = Number(cRows[0]?.c) || 0

          if (!primed) {
            primed = true
            prevMaxCreated = maxCreated
            prevUnread = unread
            return
          }

          if (maxCreated === prevMaxCreated && unread === prevUnread) return

          let latest: ApiNotification | null = null
          if (maxCreated > prevMaxCreated) {
            const { rows: lr } = await pool.query<{
              id: string
              kind: string
              title: string
              body: string
              workspace_id: string
              channel_id: string | null
              message_id: string | null
              ticket_id: string | null
              read_at: string
              created_at: string
            }>(
              `SELECT id, kind, title, body, workspace_id, channel_id, message_id, ticket_id, read_at, created_at
               FROM aaelink.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [uid]
            )
            const r = lr[0]
            if (r) {
              latest = {
                id: r.id,
                kind: r.kind,
                title: r.title,
                body: r.body,
                workspace_id: r.workspace_id,
                channel_id: r.channel_id,
                message_id: r.message_id,
                ticket_id: r.ticket_id,
                read_at: Number(r.read_at) || 0,
                created_at: Number(r.created_at) || 0
              }
            }
          }

          prevMaxCreated = maxCreated
          prevUnread = unread

          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({
                unread_count: unread,
                ...(latest ? { latest } : {})
              })}\n\n`
            )
          )
          ticks += 1
          if (ticks % 10 === 0) {
            controller.enqueue(enc.encode(': ping\n\n'))
          }
        } catch {
          /* keep stream alive */
        } finally {
          inFlight = false
        }
      }

      req.signal.addEventListener('abort', stop)

      void tick()
      timer = setInterval(() => void tick(), 2500)
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
export const GET    = tracedRoute('GET', '/api/notifications/stream', _GET)
