// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextResponse } from 'next/server'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  ChannelArchivalEngine,
  DEFAULT_ARCHIVAL_POLICY,
  type ArchivalPolicy,
} from '@/lib/channels/channelArchival'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'

const engine = new ChannelArchivalEngine()

async function requireAdmin(): Promise<{ uid: string } | NextResponse> {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = rows[0]?.platform_role || ''
  if (role !== 'admin' && role !== 'super_admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { uid }
}

// ── GET — get policy + preview ───────────────────────────────────────
async function _GET(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'preview') {
    const workspaceId = url.searchParams.get('workspace_id')
    if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
    await ensureSchema()

    const { rows } = await pool.query<{
      id: string; name: string; workspace_id: string;
      last_activity_at: string; member_count: string; is_archived: boolean
    }>(
      `SELECT c.id, c.name, c.workspace_id,
              COALESCE(c.last_activity_at, c.created_at) AS last_activity_at,
              (SELECT COUNT(*)::int FROM aaelink.channel_members cm WHERE cm.channel_id = c.id) AS member_count,
              COALESCE(c.is_archived, false) AS is_archived
       FROM aaelink.channels c
       WHERE c.workspace_id = $1`,
      [workspaceId]
    )

    const channels = rows.map(r => ({
      id: r.id,
      name: r.name,
      workspace_id: r.workspace_id,
      last_activity_at: Number(r.last_activity_at),
      member_count: Number(r.member_count),
      is_archived: r.is_archived,
    }))

    const result = engine.preview(channels)
    return NextResponse.json(result)
  }

  return NextResponse.json({ policy: engine.getPolicy(), defaults: DEFAULT_ARCHIVAL_POLICY })
}

// ── PUT — update policy ──────────────────────────────────────────────
async function _PUT(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json()) as Partial<ArchivalPolicy>
  const updated = engine.updatePolicy(body)
  return NextResponse.json({ policy: updated })
}

// ── POST — execute archival ──────────────────────────────────────────
async function _POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json()) as { workspace_id?: string }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { rows } = await pool.query<{
    id: string; name: string; workspace_id: string;
    last_activity_at: string; member_count: string; is_archived: boolean
  }>(
    `SELECT c.id, c.name, c.workspace_id,
            COALESCE(c.last_activity_at, c.created_at) AS last_activity_at,
            (SELECT COUNT(*)::int FROM aaelink.channel_members cm WHERE cm.channel_id = c.id) AS member_count,
            COALESCE(c.is_archived, false) AS is_archived
     FROM aaelink.channels c
     WHERE c.workspace_id = $1`,
    [workspaceId]
  )

  const channels = rows.map(r => ({
    id: r.id,
    name: r.name,
    workspace_id: r.workspace_id,
    last_activity_at: Number(r.last_activity_at),
    member_count: Number(r.member_count),
    is_archived: r.is_archived,
  }))

  const now = Date.now()

  const result = await engine.execute(
    channels,
    async (channelId) => {
      await pool.query(
        `UPDATE aaelink.channels SET is_archived = true, updated_at = $1 WHERE id = $2`,
        [now, channelId]
      )
    },
    async (channelId, daysRemaining) => {
      await pool.query(
        `INSERT INTO aaelink.messages (id, channel_id, user_id, content, type, created_at)
         VALUES ($1, $2, 'system', $3, 'system', $4)`,
        [
          `sys-archive-warn-${channelId}-${now}`,
          channelId,
          `⚠️ This channel will be archived in ${daysRemaining} day(s) due to inactivity. Post a message to prevent archival.`,
          now,
        ]
      )
    },
  )

  return NextResponse.json(result)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET', '/api/admin/channel-archival', _GET)
export const PUT  = tracedRoute('PUT', '/api/admin/channel-archival', _PUT)
export const POST = tracedRoute('POST', '/api/admin/channel-archival', _POST)
