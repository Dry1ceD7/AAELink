// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Cluster Management API — horizontal scaling configuration + node health.
 *
 * GET  /api/admin/cluster — view cluster topology, node health, scaling config
 * PUT  /api/admin/cluster — update cluster configuration
 *
 * Features:
 *   - Node registration + heartbeat monitoring
 *   - Auto-scaling rules (min/max instances, CPU/memory thresholds)
 *   - Session affinity configuration (sticky sessions vs distributed)
 *   - SSE/WebSocket fan-out strategy (Redis pub/sub, NATS, Postgres NOTIFY)
 *   - Database connection pool management
 *   - Load balancer health check endpoints
 *   - Rolling deployment coordination
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Cluster config
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'cluster_config'`
  )
  const defaultConfig = {
    mode: 'standalone' as string,  // 'standalone' | 'clustered'
    min_instances: 1,
    max_instances: 1,
    autoscale_enabled: false,
    cpu_scale_up_threshold: 70,
    cpu_scale_down_threshold: 30,
    memory_scale_up_threshold: 80,
    session_affinity: 'none' as string, // 'none' | 'cookie' | 'ip_hash'
    fanout_strategy: 'postgres_notify' as string, // 'postgres_notify' | 'redis_pubsub' | 'nats'
    redis_url: '',
    nats_url: '',
    db_pool_min: 5,
    db_pool_max: 20,
    health_check_interval_ms: 30000,
    rolling_update_max_surge: 1,
    rolling_update_max_unavailable: 0,
  }
  let config = defaultConfig
  if (cfgRows[0]?.value) { try { config = { ...defaultConfig, ...JSON.parse(cfgRows[0].value) } } catch { /**/ } }

  // Node registry
  const { rows: nodes } = await pool.query(`
    SELECT * FROM aaelink.cluster_nodes ORDER BY last_heartbeat DESC
  `)

  const now = Date.now()
  const nodeList = nodes.map(n => {
    const lastHb = Number(n.last_heartbeat || 0)
    return {
      ...n,
      status: (now - lastHb) < config.health_check_interval_ms * 3 ? 'healthy' : 'unhealthy',
      last_heartbeat: lastHb,
      registered_at: Number(n.registered_at || 0),
    }
  })

  // Current process info (this node)
  const thisNode = {
    node_id: process.env.HOSTNAME || `node-${process.pid}`,
    pid: process.pid,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    platform: process.platform,
    node_version: process.version,
  }

  return NextResponse.json({
    config,
    nodes: nodeList,
    current_node: thisNode,
    summary: {
      total_nodes: nodeList.length || 1,
      healthy: nodeList.filter(n => n.status === 'healthy').length || 1,
      unhealthy: nodeList.filter(n => n.status === 'unhealthy').length,
    },
  })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'update_config' | 'register_node' | 'heartbeat' | 'deregister_node'
    // Config
    mode?: string; min_instances?: number; max_instances?: number
    autoscale_enabled?: boolean; session_affinity?: string
    fanout_strategy?: string; redis_url?: string; nats_url?: string
    // Node operations
    node_id?: string; node_url?: string
    cpu_percent?: number; memory_percent?: number
    active_connections?: number
  }

  const now = Date.now()

  if (body.action === 'register_node') {
    const nodeId = body.node_id || `node-${randomUUID().slice(0, 8)}`
    await pool.query(`
      INSERT INTO aaelink.cluster_nodes
        (id, node_id, node_url, cpu_percent, memory_percent, active_connections,
         version, registered_at, last_heartbeat)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      ON CONFLICT (node_id) DO UPDATE SET
        node_url = $3, cpu_percent = $4, memory_percent = $5,
        active_connections = $6, last_heartbeat = $8
    `, [randomUUID(), nodeId, body.node_url || '',
        body.cpu_percent || 0, body.memory_percent || 0, body.active_connections || 0,
        process.env.npm_package_version || '0.0.7', now])

    return NextResponse.json({ ok: true, node_id: nodeId, registered_at: now })
  }

  if (body.action === 'heartbeat') {
    const nodeId = String(body.node_id || '').trim()
    if (!nodeId) return NextResponse.json({ error: 'node_id_required' }, { status: 400 })

    await pool.query(`
      UPDATE aaelink.cluster_nodes SET
        cpu_percent = $1, memory_percent = $2, active_connections = $3, last_heartbeat = $4
      WHERE node_id = $5
    `, [body.cpu_percent || 0, body.memory_percent || 0, body.active_connections || 0, now, nodeId])

    return NextResponse.json({ ok: true, next_heartbeat_ms: 30000 })
  }

  if (body.action === 'deregister_node') {
    const nodeId = String(body.node_id || '').trim()
    if (!nodeId) return NextResponse.json({ error: 'node_id_required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.cluster_nodes WHERE node_id = $1`, [nodeId])
    return NextResponse.json({ ok: true, deregistered: nodeId })
  }

  // Default: update cluster config
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'cluster_config'`
  )
  let current: Record<string, unknown> = {}
  if (cfgRows[0]?.value) { try { current = JSON.parse(cfgRows[0].value) } catch { /**/ } }

  const updated = { ...current, ...body }
  delete updated.action

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('cluster_config', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
    VALUES ($1, $2, 'cluster_config_updated', 'system', 'cluster', $3, $4)
  `, [randomUUID(), uid, JSON.stringify({ mode: updated.mode }), now])

  return NextResponse.json({ config: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/cluster', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/cluster', _PUT)
