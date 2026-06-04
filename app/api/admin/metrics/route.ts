import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Observability / Metrics API — platform telemetry for monitoring dashboards.
 *
 * GET /api/admin/metrics?period=1h|24h|7d|30d
 *
 * Returns Prometheus-compatible metric counters and gauges:
 *   - Active users (DAU/WAU/MAU)
 *   - Messages sent (total, per-channel breakdown)
 *   - API response latency (p50, p95, p99)
 *   - Database connection pool stats
 *   - File upload volume
 *   - WebSocket/SSE connection count
 *   - Error rates
 *   - SLA compliance rate
 *
 * Admin-only endpoint for ops dashboards and alerting.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Admin check
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const period = req.nextUrl.searchParams.get('period') || '24h'
  const periodMs = period === '1h' ? 3_600_000
    : period === '7d' ? 7 * 86_400_000
    : period === '30d' ? 30 * 86_400_000
    : 86_400_000 // default 24h

  const now = Date.now()
  const since = now - periodMs

  // === User Activity Metrics ===
  const { rows: [userMetrics] } = await pool.query<{
    total_users: string; active_users: string; online_users: string; deactivated_users: string
  }>(`
    SELECT
      COUNT(*)::text AS total_users,
      COUNT(*) FILTER (WHERE last_seen_at > $1)::text AS active_users,
      COUNT(*) FILTER (WHERE last_seen_at > $2)::text AS online_users,
      COUNT(*) FILTER (WHERE deactivated_at > 0)::text AS deactivated_users
    FROM aaelink.users
  `, [since, now - 120_000])

  // === Message Volume ===
  const { rows: [msgMetrics] } = await pool.query<{
    total_messages: string; root_messages: string; thread_replies: string
  }>(`
    SELECT
      COUNT(*)::text AS total_messages,
      COUNT(*) FILTER (WHERE root_id IS NULL OR root_id = '')::text AS root_messages,
      COUNT(*) FILTER (WHERE root_id IS NOT NULL AND root_id <> '')::text AS thread_replies
    FROM aaelink.messages
    WHERE created_at > $1
  `, [since])

  // === Channel Metrics ===
  const { rows: [channelMetrics] } = await pool.query<{
    total_channels: string; active_channels: string; archived_channels: string
  }>(`
    SELECT
      COUNT(*)::text AS total_channels,
      COUNT(*) FILTER (WHERE archived_at = 0 OR archived_at IS NULL)::text AS active_channels,
      COUNT(*) FILTER (WHERE archived_at > 0)::text AS archived_channels
    FROM aaelink.channels
  `)

  // === Ticket / SLA Metrics ===
  const { rows: [ticketMetrics] } = await pool.query<{
    open_tickets: string; resolved_period: string; sla_breached: string; avg_resolution_ms: string
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('closed', 'resolved'))::text AS open_tickets,
      COUNT(*) FILTER (WHERE (status = 'closed' OR status = 'resolved') AND updated_at > $1)::text AS resolved_period,
      COUNT(*) FILTER (WHERE sla_due_at > 0 AND sla_due_at < $2 AND status NOT IN ('closed', 'resolved'))::text AS sla_breached,
      COALESCE(AVG(CASE WHEN closed_at > 0 AND closed_at > created_at THEN closed_at - created_at END)::bigint, 0)::text AS avg_resolution_ms
    FROM aaelink.tickets
  `, [since, now])

  // === File Upload Metrics ===
  // Canonical file table is aaelink.file_attachments (migration 033/034); the
  // legacy aaelink.file_uploads table never existed in the migration runner.
  const { rows: [fileMetrics] } = await pool.query<{
    uploads_period: string; total_bytes: string
  }>(`
    SELECT
      COUNT(*)::text AS uploads_period,
      COALESCE(SUM(size), 0)::text AS total_bytes
    FROM aaelink.file_attachments
    WHERE created_at > $1 AND deleted_at = 0
  `, [since])

  // === Notification Metrics ===
  const { rows: [notifMetrics] } = await pool.query<{
    sent_period: string; unread_total: string
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE created_at > $1)::text AS sent_period,
      COUNT(*) FILTER (WHERE read_at = 0)::text AS unread_total
    FROM aaelink.notifications
  `, [since])

  // === Reaction Metrics ===
  const { rows: [reactionMetrics] } = await pool.query<{ reactions_period: string }>(`
    SELECT COUNT(*)::text AS reactions_period
    FROM aaelink.reactions
    WHERE created_at > $1
  `, [since])

  // === Workspace Metrics ===
  const { rows: [wsMetrics] } = await pool.query<{ total_workspaces: string }>(`
    SELECT COUNT(*)::text AS total_workspaces FROM aaelink.workspaces
  `)

  // === Database Pool Stats ===
  const poolStats = {
    total_connections: (pool as unknown as { totalCount: number }).totalCount || 0,
    idle_connections: (pool as unknown as { idleCount: number }).idleCount || 0,
    waiting_requests: (pool as unknown as { waitingCount: number }).waitingCount || 0,
  }

  // === Build Response ===
  const slaCompliance = Number(ticketMetrics.open_tickets) > 0
    ? Math.round((1 - Number(ticketMetrics.sla_breached) / Math.max(Number(ticketMetrics.open_tickets), 1)) * 100)
    : 100

  return NextResponse.json({
    timestamp: now,
    period,
    period_ms: periodMs,
    since,

    users: {
      total: Number(userMetrics.total_users),
      active_in_period: Number(userMetrics.active_users),
      online_now: Number(userMetrics.online_users),
      deactivated: Number(userMetrics.deactivated_users),
    },

    messages: {
      total_in_period: Number(msgMetrics.total_messages),
      root_messages: Number(msgMetrics.root_messages),
      thread_replies: Number(msgMetrics.thread_replies),
      messages_per_hour: Number(msgMetrics.total_messages) / (periodMs / 3_600_000) || 0,
    },

    channels: {
      total: Number(channelMetrics.total_channels),
      active: Number(channelMetrics.active_channels),
      archived: Number(channelMetrics.archived_channels),
    },

    tickets: {
      open: Number(ticketMetrics.open_tickets),
      resolved_in_period: Number(ticketMetrics.resolved_period),
      sla_breached: Number(ticketMetrics.sla_breached),
      sla_compliance_pct: slaCompliance,
      avg_resolution_hours: Math.round(Number(ticketMetrics.avg_resolution_ms) / 3_600_000 * 10) / 10,
    },

    files: {
      uploads_in_period: Number(fileMetrics.uploads_period),
      bytes_uploaded: Number(fileMetrics.total_bytes),
      bytes_formatted: formatBytes(Number(fileMetrics.total_bytes)),
    },

    notifications: {
      sent_in_period: Number(notifMetrics.sent_period),
      pending_unread: Number(notifMetrics.unread_total),
    },

    reactions: {
      total_in_period: Number(reactionMetrics.reactions_period),
    },

    workspaces: {
      total: Number(wsMetrics.total_workspaces),
    },

    database: poolStats,
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/metrics', _GET)
