import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Data Loss Prevention (DLP) API — content scanning rules and policies.
 *
 * GET  /api/compliance/dlp — list DLP rules and recent violations
 * POST /api/compliance/dlp — create a new DLP rule
 * PUT  /api/compliance/dlp — update DLP configuration
 *
 * DLP rule types:
 *   - pattern_match  — regex patterns for sensitive data (SSN, CC, etc.)
 *   - keyword_block  — blocked words/phrases
 *   - file_type      — restricted file extensions
 *   - domain_block   — blocked external link domains
 *   - pii_detect     — automatic PII detection (email, phone, address)
 *
 * Actions:
 *   - warn    — allow but notify sender
 *   - redact  — replace matched content with [REDACTED]
 *   - block   — prevent message/file from being sent
 *   - log     — silently log for compliance review
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

  // Get DLP rules
  const { rows: rules } = await pool.query(`
    SELECT * FROM aaelink.dlp_rules
    ORDER BY priority DESC, created_at ASC
  `)

  // Get recent violations
  const { rows: violations } = await pool.query(`
    SELECT v.*, u.username, r.name AS rule_name
    FROM aaelink.dlp_violations v
    LEFT JOIN aaelink.users u ON u.id = v.user_id
    LEFT JOIN aaelink.dlp_rules r ON r.id = v.rule_id
    ORDER BY v.created_at DESC
    LIMIT 50
  `)

  // Summary
  const { rows: [summary] } = await pool.query<{
    total_rules: string; active_rules: string
    violations_24h: string; violations_7d: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.dlp_rules) AS total_rules,
      (SELECT COUNT(*)::text FROM aaelink.dlp_rules WHERE is_active = true) AS active_rules,
      (SELECT COUNT(*)::text FROM aaelink.dlp_violations WHERE created_at > $1) AS violations_24h,
      (SELECT COUNT(*)::text FROM aaelink.dlp_violations WHERE created_at > $2) AS violations_7d
  `, [Date.now() - 86400000, Date.now() - 604800000])

  return NextResponse.json({
    rules: rules.map(r => ({ ...r, created_at: Number(r.created_at) })),
    recent_violations: violations.map(v => ({ ...v, created_at: Number(v.created_at) })),
    summary: {
      total_rules: Number(summary.total_rules),
      active_rules: Number(summary.active_rules),
      violations_24h: Number(summary.violations_24h),
      violations_7d: Number(summary.violations_7d),
    }
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
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; type?: string; pattern?: string; action?: string
    priority?: number; scope_channels?: string[]; description?: string
    severity?: string
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const VALID_TYPES = ['pattern_match', 'keyword_block', 'file_type', 'domain_block', 'pii_detect']
  const VALID_ACTIONS = ['warn', 'redact', 'block', 'log']
  const VALID_SEVERITY = ['low', 'medium', 'high', 'critical']

  const type = VALID_TYPES.includes(body.type || '') ? body.type! : 'pattern_match'
  const action = VALID_ACTIONS.includes(body.action || '') ? body.action! : 'warn'
  const severity = VALID_SEVERITY.includes(body.severity || '') ? body.severity! : 'medium'

  if (!body.pattern && type !== 'pii_detect') {
    return NextResponse.json({ error: 'pattern_required_for_non_pii_rules' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.dlp_rules
      (id, name, description, type, pattern, action, severity, priority,
       scope_channels, is_active, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
  `, [
    id, name, body.description || '', type, body.pattern || '',
    action, severity, Math.min(Math.max(body.priority || 5, 1), 10),
    JSON.stringify(body.scope_channels || []), uid, now
  ])

  return NextResponse.json({
    rule: { id, name, type, action, severity, is_active: true, created_at: now }
  }, { status: 201 })
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
    rule_id?: string; is_active?: boolean; name?: string
    pattern?: string; action?: string; priority?: number
  }

  const ruleId = String(body.rule_id || '').trim()
  if (!ruleId) return NextResponse.json({ error: 'rule_id_required' }, { status: 400 })

  const updates: string[] = []
  const params: (string | number | boolean)[] = []

  if (body.is_active !== undefined) { params.push(body.is_active); updates.push(`is_active = $${params.length}`) }
  if (body.name) { params.push(body.name); updates.push(`name = $${params.length}`) }
  if (body.pattern) { params.push(body.pattern); updates.push(`pattern = $${params.length}`) }
  if (body.action) { params.push(body.action); updates.push(`action = $${params.length}`) }
  if (body.priority) { params.push(body.priority); updates.push(`priority = $${params.length}`) }

  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  params.push(ruleId)
  const { rowCount } = await pool.query(
    `UPDATE aaelink.dlp_rules SET ${updates.join(', ')} WHERE id = $${params.length}`, params
  )
  if (!rowCount) return NextResponse.json({ error: 'rule_not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, updated: ruleId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/compliance/dlp', _GET)
export const POST   = tracedRoute('POST', '/api/compliance/dlp', _POST)
export const PUT    = tracedRoute('PUT', '/api/compliance/dlp', _PUT)
