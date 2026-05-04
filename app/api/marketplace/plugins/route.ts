import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/**
 * GET  /api/marketplace/plugins?workspace_id=...  → List all published plugins
 * POST /api/marketplace/plugins                    → Publish a new plugin
 */

export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })

  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.username) AS author
       FROM aaelink.marketplace_plugins p
       LEFT JOIN aaelink.users u ON p.created_by = u.id
       WHERE p.workspace_id = $1 AND p.is_published = true
       ORDER BY p.downloads DESC, p.created_at DESC`,
      [workspaceId]
    )
    return NextResponse.json({ plugins: rows })
  } catch (err) {
    console.error('[marketplace/plugins GET]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { workspace_id, name, slug, description, version, icon_emoji, icon_bg, category } = body as {
    workspace_id?: string
    name?: string
    slug?: string
    description?: string
    version?: string
    icon_emoji?: string
    icon_bg?: string
    category?: string
  }

  if (!workspace_id || !name?.trim() || !slug?.trim() || !description?.trim()) {
    return NextResponse.json({ error: 'workspace_id, name, slug, and description are required' }, { status: 400 })
  }

  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const id = randomUUID()
  const now = Date.now()

  try {
    // Check for duplicate slug
    const { rows: existing } = await pool.query(
      `SELECT id FROM aaelink.marketplace_plugins WHERE workspace_id = $1 AND slug = $2`,
      [workspace_id, cleanSlug]
    )
    if (existing.length > 0) {
      return NextResponse.json({ error: `A plugin with slug "${cleanSlug}" already exists.` }, { status: 409 })
    }

    await pool.query(
      `INSERT INTO aaelink.marketplace_plugins
       (id, workspace_id, name, slug, description, version, icon_emoji, icon_bg, category, downloads, rating, is_published, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 5.0, true, $10, $11, $12)`,
      [id, workspace_id, name.trim(), cleanSlug, description.trim(), version?.trim() || '1.0.0',
       icon_emoji || '🧩', icon_bg || '#5865f2', category || 'other', uid, now, now]
    )

    return NextResponse.json({ success: true, id })
  } catch (err) {
    console.error('[marketplace/plugins POST]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
