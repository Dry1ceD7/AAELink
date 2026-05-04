import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/**
 * GET    /api/marketplace/installed?workspace_id=...   → List user's installed plugins
 * POST   /api/marketplace/install                      → Install a plugin
 * DELETE /api/marketplace/install?workspace_id=...&plugin_id=...  → Uninstall
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
      `SELECT plugin_id, installed_at, enabled FROM aaelink.installed_plugins
       WHERE user_id = $1 AND workspace_id = $2
       ORDER BY installed_at DESC`,
      [uid, workspaceId]
    )
    return NextResponse.json({ installed: rows })
  } catch (err) {
    console.error('[marketplace/installed GET]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
