import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/tracedRoute'

async function _GET(req: NextRequest) {
  try {
    const userId = await readSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

    const userRes = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    if (!userRes.rows[0] || !isPlatformAdmin(userRes.rows[0].platform_role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const ssoRes = await pool.query(`SELECT * FROM aaelink.sso_configs WHERE provider = 'entra'`)
    const config = ssoRes.rows[0] || null

    return NextResponse.json({ config })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sso_query_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function _POST(req: NextRequest) {
  try {
    const userId = await readSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

    const userRes = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [userId])
    if (!userRes.rows[0] || !isPlatformAdmin(userRes.rows[0].platform_role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { tenant_id, client_id, client_secret, is_enabled } = await req.json()
    if (!tenant_id || !client_id || !client_secret) {
      return NextResponse.json({ error: 'Missing required Entra ID fields' }, { status: 400 })
    }

    const id = randomUUID()
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.sso_configs (id, provider, tenant_id, client_id, client_secret, is_enabled, updated_at)
      VALUES ($1, 'entra', $2, $3, $4, $5, $6)
      ON CONFLICT (provider) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = EXCLUDED.updated_at
    `, [id, tenant_id, client_id, client_secret, is_enabled ? true : false, now])

    const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
    const userAgent = req.headers.get('user-agent') || ''
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      randomUUID(),
      userId,
      userRes.rows[0].platform_role,
      'sso_config_update',
      'sso_config',
      'entra',
      ipAddress,
      userAgent,
      JSON.stringify({ tenant_id, client_id, is_enabled }),
      now
    ])

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sso_update_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/sso', _GET)
export const POST   = tracedRoute('POST', '/api/admin/sso', _POST)
