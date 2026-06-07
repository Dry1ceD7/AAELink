import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { searchChannels } from '@/lib/messaging/searchChannels'
import type { Pool } from 'pg'

async function assertWorkspaceMember(pool: Pool, uid: string, workspaceId: string) {
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  return rows.length > 0
}

async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const workspaceId = String(url.searchParams.get('workspace_id') || url.searchParams.get('team_id') || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const q = String(url.searchParams.get('q') || '').trim()
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '25', 10) || 25, 1), 100)
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0)

  await ensureSchema()

  if (!(await assertWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const result = await searchChannels(pool, uid, { q, workspaceId, limit, offset })

  return NextResponse.json(result)
}

export const GET = tracedRoute('GET', '/api/search/channels', _GET)
