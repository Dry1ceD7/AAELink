import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/tracedRoute'

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')
  
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  }

  try {
    const { rows: apps } = await pool.query(
      `SELECT * FROM aaelink.apps WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId]
    )
    return NextResponse.json({ apps })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'apps_query_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { workspace_id, name, description, icon_url } = body

    if (!workspace_id || !name) {
      return NextResponse.json({ error: 'missing required fields' }, { status: 400 })
    }

    const id = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.apps (id, workspace_id, name, description, icon_url, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, workspace_id, name, description || '', icon_url || '', userId, Date.now()]
    )

    return NextResponse.json({ success: true, id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'app_create_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/integrations/apps', _GET)
export const POST   = tracedRoute('POST', '/api/integrations/apps', _POST)
