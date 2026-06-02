import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Audit Log Streaming API — export audit events to SIEM/S3/webhook.
 *
 * GET  /api/admin/audit-log/stream — list stream configurations
 * POST /api/admin/audit-log/stream — create/manage stream destinations
 * PUT  /api/admin/audit-log/stream — update stream config
 *
 * Stream destinations:
 *   - webhook: POST audit events in real-time to an HTTP endpoint
 *   - s3: Batch export audit events to an S3 bucket (hourly/daily)
 *   - syslog: Forward events to a syslog endpoint (RFC 5424)
 *
 * Event filtering:
 *   - By action category (auth, admin, compliance, messaging)
 *   - By severity (info, warning, critical)
 *   - By actor role
 *
 * Super admin only.
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
  if (!['super_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const view = req.nextUrl.searchParams.get('view') || ''

  // List stream destinations
  if (!view || view === 'destinations') {
    const config = await getConfig(pool, 'audit_stream_destinations')
    return NextResponse.json({ destinations: config })
  }

  // Stream health/stats
  if (view === 'stats') {
    const now = Date.now()
    const day = 86400000
    const { rows: [stats] } = await pool.query<{
      total_24h: string; auth_24h: string; admin_24h: string
      compliance_24h: string; messaging_24h: string
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE created_at > $1) AS total_24h,
        (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE action LIKE 'auth.%' AND created_at > $1) AS auth_24h,
        (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE action LIKE 'admin.%' AND created_at > $1) AS admin_24h,
        (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE action LIKE 'compliance.%' AND created_at > $1) AS compliance_24h,
        (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE action LIKE 'message.%' AND created_at > $1) AS messaging_24h
    `, [now - day])

    return NextResponse.json({
      stats: {
        total_24h: Number(stats?.total_24h || 0),
        by_category: {
          auth: Number(stats?.auth_24h || 0),
          admin: Number(stats?.admin_24h || 0),
          compliance: Number(stats?.compliance_24h || 0),
          messaging: Number(stats?.messaging_24h || 0),
        },
      },
    })
  }

  // Export audit events as JSON (manual download)
  if (view === 'export') {
    const since = Number(req.nextUrl.searchParams.get('since') || Date.now() - 86400000)
    const until = Number(req.nextUrl.searchParams.get('until') || Date.now())
    const category = req.nextUrl.searchParams.get('category') || ''
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 10000), 50000)

    let query = `SELECT * FROM aaelink.audit_log WHERE created_at >= $1 AND created_at <= $2`
    const params: unknown[] = [since, until]

    if (category) {
      params.push(`${category}.%`)
      query += ` AND action LIKE $${params.length}`
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
    params.push(limit)

    const { rows } = await pool.query(query, params)

    return new NextResponse(JSON.stringify({ count: rows.length, events: rows }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  }

  return NextResponse.json({ error: 'unknown_view', available: ['destinations', 'stats', 'export'] }, { status: 400 })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'add_destination' | 'remove_destination' | 'test_destination'
    destination_type?: 'webhook' | 's3' | 'syslog'
    name?: string; url?: string; bucket?: string; prefix?: string
    events?: string[]; is_active?: boolean
    destination_id?: string
  }

  if (body.action === 'add_destination') {
    const destType = body.destination_type
    if (!destType || !['webhook', 's3', 'syslog'].includes(destType)) {
      return NextResponse.json({ error: 'destination_type_required (webhook|s3|syslog)' }, { status: 400 })
    }

    const destinations = await getConfig(pool, 'audit_stream_destinations') as Array<Record<string, unknown>>
    const newDest = {
      id: randomUUID(),
      type: destType,
      name: String(body.name || `${destType}-stream`),
      url: body.url || '',
      bucket: body.bucket || '',
      prefix: body.prefix || 'audit/',
      events: body.events || ['*'],
      is_active: body.is_active !== false,
      created_at: Date.now(),
      created_by: uid,
    }

    destinations.push(newDest)
    await setConfig(pool, 'audit_stream_destinations', destinations, uid)

    return NextResponse.json({ destination: newDest }, { status: 201 })
  }

  if (body.action === 'remove_destination') {
    const destId = String(body.destination_id || '')
    if (!destId) return NextResponse.json({ error: 'destination_id_required' }, { status: 400 })

    const destinations = await getConfig(pool, 'audit_stream_destinations') as Array<Record<string, unknown>>
    const filtered = destinations.filter(d => d.id !== destId)
    if (filtered.length === destinations.length) {
      return NextResponse.json({ error: 'destination_not_found' }, { status: 404 })
    }
    await setConfig(pool, 'audit_stream_destinations', filtered, uid)

    return NextResponse.json({ ok: true, removed: destId })
  }

  if (body.action === 'test_destination') {
    const destId = String(body.destination_id || '')
    if (!destId) return NextResponse.json({ error: 'destination_id_required' }, { status: 400 })

    const destinations = await getConfig(pool, 'audit_stream_destinations') as Array<Record<string, unknown>>
    const dest = destinations.find(d => d.id === destId)
    if (!dest) return NextResponse.json({ error: 'destination_not_found' }, { status: 404 })

    // Test delivery
    if (dest.type === 'webhook' && dest.url) {
      try {
        const testPayload = JSON.stringify({
          event: 'audit.test',
          timestamp: new Date().toISOString(),
          data: { message: 'Test audit stream from AAELink' },
        })
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(String(dest.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'AAELink-Audit/1.0' },
          body: testPayload,
          signal: controller.signal,
        })
        clearTimeout(timeout)
        return NextResponse.json({ test: res.ok ? 'success' : 'failed', status_code: res.status })
      } catch (err: unknown) {
        return NextResponse.json({ test: 'failed', error: err instanceof Error ? err.message : 'Unknown' })
      }
    }

    // S3 test: verify bucket accessibility
    if (dest.type === 's3' && dest.bucket) {
      try {
        const endpoint = String(dest.endpoint || process.env.MINIO_ENDPOINT || 'http://localhost:9000')
        const bucket = String(dest.bucket)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(`${endpoint}/${bucket}`, {
          method: 'HEAD',
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (res.ok || res.status === 200 || res.status === 403) {
          // 403 means bucket exists but credentials may differ — reachable
          return NextResponse.json({ test: 'success', status_code: res.status, note: res.status === 403 ? 'Bucket exists but access denied — check credentials' : 'Bucket reachable' })
        }
        return NextResponse.json({ test: 'failed', status_code: res.status, error: 'Bucket not found or unreachable' })
      } catch (err: unknown) {
        return NextResponse.json({ test: 'failed', error: err instanceof Error ? err.message : 'S3 connectivity failed' })
      }
    }

    // Syslog test: verify endpoint reachability via TCP probe
    if (dest.type === 'syslog' && dest.host) {
      try {
        const host = String(dest.host)
        const port = Number(dest.port) || 514
        const { createConnection } = await import('net')
        const connected = await new Promise<boolean>((resolve) => {
          const sock = createConnection({ host, port, timeout: 5000 }, () => {
            // Send a test syslog message (RFC 5424)
            const msg = `<14>1 ${new Date().toISOString()} aaelink audit-test - - - AAELink syslog connectivity test`
            sock.write(msg, () => { sock.end(); resolve(true) })
          })
          sock.on('error', () => { sock.destroy(); resolve(false) })
          sock.on('timeout', () => { sock.destroy(); resolve(false) })
        })
        return NextResponse.json({ test: connected ? 'success' : 'failed', host, port })
      } catch (err: unknown) {
        return NextResponse.json({ test: 'failed', error: err instanceof Error ? err.message : 'Syslog connectivity failed' })
      }
    }

    return NextResponse.json({ test: 'skipped', reason: `Unsupported destination type: ${dest.type}` })
  }

  return NextResponse.json({ error: 'action required (add_destination|remove_destination|test_destination)' }, { status: 400 })
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
  if (!['super_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    destination_id?: string; is_active?: boolean; events?: string[]; name?: string; url?: string
  }

  const destId = String(body.destination_id || '')
  if (!destId) return NextResponse.json({ error: 'destination_id_required' }, { status: 400 })

  const destinations = await getConfig(pool, 'audit_stream_destinations') as Array<Record<string, unknown>>
  const idx = destinations.findIndex(d => d.id === destId)
  if (idx === -1) return NextResponse.json({ error: 'destination_not_found' }, { status: 404 })

  if (body.is_active !== undefined) destinations[idx].is_active = body.is_active
  if (body.events) destinations[idx].events = body.events
  if (body.name) destinations[idx].name = body.name
  if (body.url) destinations[idx].url = body.url

  await setConfig(pool, 'audit_stream_destinations', destinations, uid)
  return NextResponse.json({ ok: true, destination: destinations[idx] })
}

// ── System Config helpers ────────────────────────────────────────────

async function getConfig(pool: Pool, key: string): Promise<unknown> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [key]
  )
  if (!rows[0]) return []
  try { return JSON.parse(rows[0].value) } catch { return rows[0].value }
}

async function setConfig(pool: Pool, key: string, value: unknown, updatedBy: string) {
  const json = JSON.stringify(value)
  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at, updated_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3, updated_by = $4
  `, [key, json, Date.now(), updatedBy])
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/audit-log/stream', _GET)
export const POST   = tracedRoute('POST', '/api/admin/audit-log/stream', _POST)
export const PUT    = tracedRoute('PUT', '/api/admin/audit-log/stream', _PUT)
