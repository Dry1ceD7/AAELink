import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const pool = getPool()
  if (!pool) return new Response('database_not_configured', { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return new Response('unauthorized', { status: 401 })
  await ensureSchema()

  const url = new URL(req.url)
  const workspaceId = String(url.searchParams.get('workspace_id') || '')
  if (!workspaceId) return new Response('workspace_id_required', { status: 400 })

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let stopped = false
      let timer: ReturnType<typeof setInterval> | null = null

      const stop = () => {
        stopped = true
        if (timer) clearInterval(timer)
        try {
          controller.close()
        } catch { /* ignored */ }
      }

      const tick = async () => {
        if (stopped || req.signal.aborted) return
        try {
          // Get all users in workspace
          const { rows } = await pool.query<{ id: string; last_seen_at: string }>(
            `SELECT u.id, u.last_seen_at 
             FROM aaelink.users u
             JOIN aaelink.workspace_members wm ON wm.user_id = u.id
             WHERE wm.workspace_id = $1`,
            [workspaceId]
          )
          
          const presence: Record<string, number> = {}
          for (const r of rows) {
            presence[r.id] = Number(r.last_seen_at) || 0
          }
          
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ presence })}\n\n`))
        } catch {
          // ignore
        }
      }

      req.signal.addEventListener('abort', stop)
      void tick()
      // Send updates every 10 seconds
      timer = setInterval(() => void tick(), 10000)
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
