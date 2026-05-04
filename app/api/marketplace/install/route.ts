import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/**
 * POST   /api/marketplace/install  → Install a plugin (body: { workspace_id, plugin_id })
 * DELETE /api/marketplace/install?workspace_id=...&plugin_id=...  → Uninstall
 */

export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { workspace_id, plugin_id } = body as { workspace_id?: string; plugin_id?: string }
  if (!workspace_id || !plugin_id) {
    return NextResponse.json({ error: 'workspace_id and plugin_id are required' }, { status: 400 })
  }

  const now = Date.now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Verify plugin exists
    const { rows: plugins } = await client.query(
      `SELECT id FROM aaelink.marketplace_plugins WHERE id = $1 AND workspace_id = $2 AND is_published = true`,
      [plugin_id, workspace_id]
    )
    if (plugins.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
    }

    // Upsert install record
    await client.query(
      `INSERT INTO aaelink.installed_plugins (id, user_id, workspace_id, plugin_id, enabled, installed_at)
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (user_id, workspace_id, plugin_id) DO UPDATE SET enabled = true, installed_at = $5`,
      [randomUUID(), uid, workspace_id, plugin_id, now]
    )

    // Bump download count
    await client.query(
      `UPDATE aaelink.marketplace_plugins SET downloads = downloads + 1 WHERE id = $1`,
      [plugin_id]
    )

    await client.query('COMMIT')
    return NextResponse.json({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[marketplace/install POST]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')
  const pluginId = req.nextUrl.searchParams.get('plugin_id')
  if (!workspaceId || !pluginId) {
    return NextResponse.json({ error: 'workspace_id and plugin_id are required' }, { status: 400 })
  }

  try {
    await pool.query(
      `DELETE FROM aaelink.installed_plugins WHERE user_id = $1 AND workspace_id = $2 AND plugin_id = $3`,
      [uid, workspaceId, pluginId]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[marketplace/install DELETE]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
