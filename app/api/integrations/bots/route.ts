import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Bot Users & OAuth Apps API — manage bot accounts and OAuth app registrations.
 *
 * GET  /api/integrations/bots — list bot users and OAuth apps
 * POST /api/integrations/bots — register a new bot user or OAuth app
 *
 * Bot users:
 *   - Can post messages, react, manage channels (scoped by permissions)
 *   - Have dedicated API tokens (not tied to human sessions)
 *   - Show as "BOT" in the UI with distinct avatar styling
 *
 * OAuth apps:
 *   - Client ID / Client Secret pair
 *   - Redirect URI validation
 *   - Scoped access tokens
 *   - App approval workflow integration
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

  const kind = req.nextUrl.searchParams.get('kind') || '' // 'bot' | 'oauth_app' | ''

  let where = ''
  const params: string[] = []
  if (kind === 'bot' || kind === 'oauth_app') {
    params.push(kind); where = `WHERE b.kind = $${params.length}`
  }

  const { rows } = await pool.query(`
    SELECT b.id, b.kind, b.name, b.description, b.avatar_url,
           b.scopes, b.status, b.client_id, b.redirect_uris,
           b.workspace_id, b.created_by, b.created_at,
           u.username AS owner_username
    FROM aaelink.bot_users b
    LEFT JOIN aaelink.users u ON u.id = b.created_by
    ${where}
    ORDER BY b.created_at DESC
    LIMIT 100
  `, params)

  return NextResponse.json({
    apps: rows.map(b => ({ ...b, created_at: Number(b.created_at) })),
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
    kind?: 'bot' | 'oauth_app'; name?: string; description?: string
    avatar_url?: string; scopes?: string[]; workspace_id?: string
    redirect_uris?: string[]
  }

  const kind = body.kind === 'oauth_app' ? 'oauth_app' : 'bot'
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (name.length > 64) return NextResponse.json({ error: 'name_too_long (64 chars max)' }, { status: 400 })

  const id = randomUUID()
  const now = Date.now()
  const clientId = `aae_${kind}_${randomBytes(16).toString('hex')}`
  const clientSecret = randomBytes(32).toString('hex')
  const apiToken = `xbot-${randomBytes(24).toString('hex')}`

  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter(s => typeof s === 'string').slice(0, 20)
    : ['messages:read', 'messages:write']

  const redirectUris = kind === 'oauth_app' && Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter(u => typeof u === 'string').slice(0, 5)
    : []

  await pool.query(`
    INSERT INTO aaelink.bot_users
      (id, kind, name, description, avatar_url, scopes, status,
       client_id, client_secret, api_token, redirect_uris,
       workspace_id, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'active',
            $7, $8, $9, $10, $11, $12, $13)
  `, [
    id, kind, name, body.description || '', body.avatar_url || '',
    JSON.stringify(scopes), clientId, clientSecret, apiToken,
    JSON.stringify(redirectUris), body.workspace_id || null, uid, now
  ])

  // Audit
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, meta, created_at)
    VALUES ($1, $2, 'bot_created', 'bot_user', $3, $4, $5)
  `, [randomUUID(), uid, id, JSON.stringify({ kind, name, scopes }), now])

  return NextResponse.json({
    app: {
      id, kind, name, status: 'active',
      client_id: clientId,
      client_secret: clientSecret, // Only shown on creation
      api_token: kind === 'bot' ? apiToken : undefined,
      scopes,
      redirect_uris: redirectUris,
      created_at: now,
    }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/integrations/bots', _GET)
export const POST   = tracedRoute('POST', '/api/integrations/bots', _POST)
