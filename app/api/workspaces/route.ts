import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { slugifySegment } from '@/lib/ui/slug'
import { tracedRoute } from '@/lib/api/tracedRoute'

async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { rows } = await pool.query<{
    id: string
    name: string
    display_name: string
    is_system: boolean
  }>(
    `SELECT w.id, w.name, w.display_name, w.is_system
     FROM aaelink.workspaces w
     INNER JOIN aaelink.workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
     ORDER BY w.is_system DESC, w.created_at ASC`,
    [uid]
  )
  return NextResponse.json({ teams: rows })
}

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as { display_name?: string; name?: string }
  const display_name = String(body.display_name || '').trim()
  if (!display_name) return NextResponse.json({ error: 'display_name_required' }, { status: 400 })
  let base = slugifySegment(String(body.name || display_name), 'workspace')
  const client = await pool.connect()
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      const name = attempt === 0 ? base : slugifySegment(`${base}-${randomUUID().slice(0, 8)}`, 'workspace')
      const wid = randomUUID()
      const cid = randomUUID()
      const now = Date.now()
      await client.query('BEGIN')
      try {
        await client.query(
          `INSERT INTO aaelink.workspaces (id, name, display_name, created_by, created_at, is_system)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [wid, name, display_name, uid, now]
        )
        await client.query(
          `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [wid, uid]
        )
        await client.query(
          `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
           VALUES ($1, $2, 'all-aaelink', 'All AAELink', 'O', $3)`,
          [cid, wid, now]
        )
        // Create default #general channel (Slack parity — auto-join target)
        const generalId = randomUUID()
        await client.query(
          `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, purpose, is_default, created_at)
           VALUES ($1, $2, 'general', 'General', 'O', $3, TRUE, $4)`,
          [generalId, wid, "This is the one channel that will always include everyone. It's a great spot for announcements and team-wide conversations.", now]
        )
        // Auto-join creator to #general
        await client.query(
          `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', $3)`,
          [generalId, uid, now]
        )
        await client.query('COMMIT')
        const team = { id: wid, name, display_name }
        return NextResponse.json({ team })
      } catch (e: unknown) {
        await client.query('ROLLBACK')
        if ((e as { code?: string })?.code === '23505') {
          base = slugifySegment(`${base}-ws`, 'workspace')
          continue
        }
        throw e
      }
    }
    return NextResponse.json({ error: 'workspace_create_failed' }, { status: 400 })
  } finally {
    client.release()
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/workspaces', _GET)
export const POST   = tracedRoute('POST', '/api/workspaces', _POST)
