import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import type { Presence, PresencePayload } from '@/lib/types/presence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A user is "away" once their last heartbeat is older than this. */
const AWAY_AFTER_MS = 10 * 60 * 1000

type PresenceStreamRow = {
  id: string
  last_seen_at: string | number | null
  status: string | null
  status_text: string | null
  status_emoji: string | null
  expires_at: string | number | null
}

/**
 * Server-side presence derivation:
 *   - dnd     → manual DND is set
 *   - offline → never seen (no heartbeat) or manual offline
 *   - away    → last_seen older than ~10 min (or manual away)
 *   - active  → recently seen
 */
function deriveStatus(manual: string, lastSeen: number, now: number): Presence {
  if (manual === 'dnd') return 'dnd'
  if (manual === 'offline') return 'offline'
  if (lastSeen <= 0) return 'offline'
  if (manual === 'away') return 'away'
  if (now - lastSeen >= AWAY_AFTER_MS) return 'away'
  return 'active'
}

/** Map a joined presence row to the derived fan-out payload (expired custom status cleared). */
function toPayload(row: PresenceStreamRow, now: number): PresencePayload {
  const lastSeen = Number(row.last_seen_at) || 0
  const expiresAt = Number(row.expires_at) || 0
  const customExpired = expiresAt > 0 && expiresAt < now
  return {
    user_id: row.id,
    status: deriveStatus((row.status || '').toLowerCase(), lastSeen, now),
    custom_emoji: customExpired ? '' : (row.status_emoji || ''),
    custom_text: customExpired ? '' : (row.status_text || ''),
    expires_at: customExpired ? 0 : expiresAt,
    last_seen: lastSeen,
  }
}

async function _GET(req: Request) {
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

      let pending = false
      const tick = async () => {
        if (stopped || req.signal.aborted || pending) return
        pending = true
        try {
          // Get all users in workspace with their manual status + custom status.
          // LEFT JOIN user_status so users without a row still appear; custom
          // status text/emoji live on aaelink.users.
          const { rows } = await pool.query<PresenceStreamRow>(
            `SELECT u.id, u.last_seen_at, us.status, u.status_text, u.status_emoji, us.expires_at
             FROM aaelink.users u
             JOIN aaelink.workspace_members wm ON wm.user_id = u.id
             LEFT JOIN aaelink.user_status us ON us.user_id = u.id
             WHERE wm.workspace_id = $1`,
            [workspaceId]
          )

          const now = Date.now()
          // Legacy shape: { presence: Record<userId, lastSeen> } — kept for
          // backward-compat with existing consumers. Richer per-user payloads
          // (server-derived status + custom status) ride alongside in `payloads`,
          // and `statuses` carries the derived Presence for status-only consumers.
          const presence: Record<string, number> = {}
          const statuses: Record<string, Presence> = {}
          const payloads: Record<string, PresencePayload> = {}
          for (const r of rows) {
            const p = toPayload(r, now)
            presence[p.user_id] = p.last_seen
            statuses[p.user_id] = p.status
            payloads[p.user_id] = p
          }

          controller.enqueue(
            enc.encode(`data: ${JSON.stringify({ presence, statuses, payloads })}\n\n`)
          )
        } catch {
          // ignore
        } finally {
          pending = false
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

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/collab/presence/stream', _GET)
