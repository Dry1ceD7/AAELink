import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Plugin Host API — plugin lifecycle management.
 *
 * GET  /api/integrations/plugins — list installed plugins
 * POST /api/integrations/plugins — install/register a plugin
 *
 * Plugin capabilities:
 *   - UI extension points (sidebar, message actions, command palette)
 *   - Webhook receivers
 *   - Slash command handlers
 *   - Message interceptors (pre/post processing)
 *   - Scheduled tasks
 *
 * Plugin states: installed → active → disabled → uninstalled
 *
 * Security:
 *   - Sandboxed execution (no direct DB access)
 *   - Scoped API tokens
 *   - Admin approval required (if policy is 'approval' mode)
 *   - Rate limits per plugin
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const wsId = req.nextUrl.searchParams.get('workspace_id') || ''
  const status = req.nextUrl.searchParams.get('status') || ''

  let where = 'WHERE 1=1'
  const params: string[] = []
  if (wsId) { params.push(wsId); where += ` AND p.workspace_id = $${params.length}` }
  if (['active', 'disabled', 'installed', 'pending_approval'].includes(status)) {
    params.push(status); where += ` AND p.status = $${params.length}`
  }

  const { rows } = await pool.query(`
    SELECT p.*, u.username AS installed_by_username
    FROM aaelink.plugins p
    LEFT JOIN aaelink.users u ON u.id = p.installed_by
    ${where}
    ORDER BY p.installed_at DESC
    LIMIT 100
  `, params)

  return NextResponse.json({
    plugins: rows.map(p => ({
      ...p,
      installed_at: Number(p.installed_at),
      updated_at: Number(p.updated_at || 0),
    })),
    total: rows.length,
  })
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
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; version?: string; description?: string
    author?: string; homepage_url?: string; icon_url?: string
    workspace_id?: string; manifest_url?: string
    capabilities?: string[]; settings_schema?: Record<string, unknown>
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  // Check app approval policy
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'app_approval_policy'`
  )
  let policyMode = 'approval'
  if (cfgRows[0]?.value) {
    try { policyMode = JSON.parse(cfgRows[0].value).mode || 'approval' } catch { /**/ }
  }

  if (policyMode === 'locked') {
    return NextResponse.json({ error: 'app_installation_locked_by_policy' }, { status: 403 })
  }

  const initialStatus = policyMode === 'approval' ? 'pending_approval' : 'active'

  const id = randomUUID()
  const now = Date.now()

  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.filter(c => typeof c === 'string').slice(0, 20)
    : []

  await pool.query(`
    INSERT INTO aaelink.plugins
      (id, name, version, description, author, homepage_url, icon_url,
       workspace_id, manifest_url, capabilities, settings_schema,
       status, installed_by, installed_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
  `, [
    id, name, body.version || '1.0.0', body.description || '',
    body.author || '', body.homepage_url || '', body.icon_url || '',
    body.workspace_id || null, body.manifest_url || '',
    JSON.stringify(capabilities), JSON.stringify(body.settings_schema || {}),
    initialStatus, uid, now
  ])

  return NextResponse.json({
    plugin: { id, name, status: initialStatus, capabilities, installed_at: now }
  }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
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

  const body = (await req.json().catch(() => ({}))) as {
    plugin_id?: string; action?: 'activate' | 'disable' | 'uninstall'
  }

  const pluginId = String(body.plugin_id || '').trim()
  if (!pluginId) return NextResponse.json({ error: 'plugin_id_required' }, { status: 400 })

  const ACTION_MAP: Record<string, string> = {
    activate: 'active',
    disable: 'disabled',
    uninstall: 'uninstalled',
  }

  const newStatus = ACTION_MAP[body.action || '']
  if (!newStatus) {
    return NextResponse.json({ error: 'valid action required (activate|disable|uninstall)' }, { status: 400 })
  }

  const now = Date.now()
  const { rowCount } = await pool.query(
    `UPDATE aaelink.plugins SET status = $1, updated_at = $2 WHERE id = $3`,
    [newStatus, now, pluginId]
  )
  if (!rowCount) return NextResponse.json({ error: 'plugin_not_found' }, { status: 404 })

  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, meta, created_at)
    VALUES ($1, $2, $3, 'plugin', $4, $5, $6)
  `, [randomUUID(), uid, `plugin_${body.action}d`, pluginId,
      JSON.stringify({ new_status: newStatus }), now])

  return NextResponse.json({ ok: true, plugin_id: pluginId, status: newStatus })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/integrations/plugins', _GET)
export const POST   = tracedRoute('POST', '/api/integrations/plugins', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/integrations/plugins', _PATCH)
