import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { slugifySegment } from '@/lib/slug'

async function assertWorkspaceMember(pool: Pool, uid: string, workspaceId: string) {
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  return rows.length > 0
}

function peerDisplayName(row: {
  username: string
  first_name: string | null
  last_name: string | null
  nickname: string | null
}) {
  const full = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  if (full) return full
  if (row.nickname) return row.nickname
  return row.username
}

export async function GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const workspace_id = String(url.searchParams.get('workspace_id') || url.searchParams.get('team_id') || '')
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  await ensureSchema()
  if (!(await assertWorkspaceMember(pool, uid, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const rootFilter = `(m.root_id IS NULL OR m.root_id = '')`
  await pool.query(
    `INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
     SELECT $1::text, c.id, COALESCE(MAX(m.created_at), 0)::bigint
     FROM aaelink.channels c
     LEFT JOIN aaelink.messages m ON m.channel_id = c.id AND ${rootFilter}
     WHERE c.workspace_id = $2::text
       AND (c.type <> 'D' OR c.dm_user_a = $1::text OR c.dm_user_b = $1::text)
     GROUP BY c.id
     ON CONFLICT (user_id, channel_id) DO NOTHING`,
    [uid, workspace_id]
  )

  const { rows } = await pool.query<{
    id: string
    team_id: string
    name: string
    display_name: string
    type: string
    dm_user_a: string | null
    dm_user_b: string | null
    dm_peer_id: string | null
    dm_peer_username: string | null
    dm_peer_first_name: string | null
    dm_peer_last_name: string | null
    dm_peer_nickname: string | null
    unread_count: string
    last_read_at: string
    latest_root_message_at: string | null
  }>(
    `SELECT c.id, c.workspace_id AS team_id, c.name, c.display_name, c.type,
            c.dm_user_a, c.dm_user_b,
            CASE
              WHEN c.type = 'D' AND c.dm_user_a = $1::text THEN c.dm_user_b
              WHEN c.type = 'D' THEN c.dm_user_a
              ELSE NULL
            END AS dm_peer_id,
            pu.username AS dm_peer_username,
            pu.first_name AS dm_peer_first_name,
            pu.last_name AS dm_peer_last_name,
            pu.nickname AS dm_peer_nickname,
            r.last_read_at::text AS last_read_at,
            (SELECT MAX(m.created_at)::text FROM aaelink.messages m
             WHERE m.channel_id = c.id AND ${rootFilter}) AS latest_root_message_at,
            (SELECT COUNT(*)::int FROM aaelink.messages m
             WHERE m.channel_id = c.id AND ${rootFilter}
             AND m.created_at > r.last_read_at) AS unread_count
     FROM aaelink.channels c
     INNER JOIN aaelink.channel_read_state r ON r.channel_id = c.id AND r.user_id = $1::text
     LEFT JOIN aaelink.users pu ON pu.id = CASE
       WHEN c.type = 'D' AND c.dm_user_a = $1::text THEN c.dm_user_b
       WHEN c.type = 'D' THEN c.dm_user_a
       ELSE NULL
     END
     WHERE c.workspace_id = $2::text
       AND (c.type <> 'D' OR c.dm_user_a = $1::text OR c.dm_user_b = $1::text)
     ORDER BY c.name ASC`,
    [uid, workspace_id]
  )

  return NextResponse.json({
    channels: rows.map(r => {
      const dm_peer_id = r.dm_peer_id || undefined
      let dm_peer_display: string | undefined
      if (r.type === 'D' && r.dm_peer_username) {
        dm_peer_display = peerDisplayName({
          username: r.dm_peer_username,
          first_name: r.dm_peer_first_name,
          last_name: r.dm_peer_last_name,
          nickname: r.dm_peer_nickname
        })
      }
      const latestRoot = r.latest_root_message_at != null ? Number(r.latest_root_message_at) : 0
      return {
        id: r.id,
        team_id: r.team_id,
        name: r.name,
        display_name: r.display_name,
        type: r.type,
        unread_count: Number(r.unread_count) || 0,
        last_read_at: Number(r.last_read_at) || 0,
        ...(Number.isFinite(latestRoot) && latestRoot > 0 ? { latest_root_message_at: latestRoot } : {}),
        ...(dm_peer_id ? { dm_peer_id, dm_peer_display } : {})
      }
    })
  })
}

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = (await req.json()) as {
    workspace_id?: string
    team_id?: string
    display_name?: string
    name?: string
    type?: string
    peer_user_id?: string
  }
  const workspace_id = String(body.workspace_id || body.team_id || '')
  if (!workspace_id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  if (!(await assertWorkspaceMember(pool, uid, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const peer_user_id = String(body.peer_user_id || '').trim()
  if (peer_user_id) {
    if (peer_user_id === uid) {
      return NextResponse.json({ error: 'invalid_peer' }, { status: 400 })
    }
    const { rows: peerMem } = await pool.query<{ ok: number }>(
      `SELECT 1 AS ok FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspace_id, peer_user_id]
    )
    if (peerMem.length === 0) {
      return NextResponse.json({ error: 'peer_not_in_workspace' }, { status: 400 })
    }

    const dm_user_a = uid < peer_user_id ? uid : peer_user_id
    const dm_user_b = uid < peer_user_id ? peer_user_id : uid

    const { rows: existing } = await pool.query<{
      id: string
      name: string
      display_name: string
      type: string
    }>(
      `SELECT id, name, display_name, type FROM aaelink.channels
       WHERE workspace_id = $1 AND type = 'D' AND dm_user_a = $2 AND dm_user_b = $3`,
      [workspace_id, dm_user_a, dm_user_b]
    )
    if (existing[0]) {
      const row = existing[0]
      return NextResponse.json({
        channel: {
          id: row.id,
          team_id: workspace_id,
          name: row.name,
          display_name: row.display_name,
          type: row.type,
          dm_peer_id: peer_user_id
        }
      })
    }

    const { rows: peerRows } = await pool.query<{
      username: string
      first_name: string | null
      last_name: string | null
      nickname: string | null
    }>(`SELECT username, first_name, last_name, nickname FROM aaelink.users WHERE id = $1`, [peer_user_id])
    const pu = peerRows[0]
    if (!pu) {
      return NextResponse.json({ error: 'peer_not_found' }, { status: 400 })
    }
    const display_name = peerDisplayName(pu)
    const id = randomUUID()
    const name = `dm-${id.replace(/-/g, '').slice(0, 20)}`
    const now = Date.now()
    try {
      await pool.query(
        `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, dm_user_a, dm_user_b)
         VALUES ($1, $2, $3, $4, 'D', $5, $6, $7)`,
        [id, workspace_id, name, display_name, now, dm_user_a, dm_user_b]
      )
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === '23505') {
        const { rows: again } = await pool.query<{ id: string; name: string; display_name: string; type: string }>(
          `SELECT id, name, display_name, type FROM aaelink.channels
           WHERE workspace_id = $1 AND type = 'D' AND dm_user_a = $2 AND dm_user_b = $3`,
          [workspace_id, dm_user_a, dm_user_b]
        )
        if (again[0]) {
          return NextResponse.json({
            channel: {
              id: again[0].id,
              team_id: workspace_id,
              name: again[0].name,
              display_name: again[0].display_name,
              type: again[0].type,
              dm_peer_id: peer_user_id
            }
          })
        }
      }
      throw e
    }
    return NextResponse.json({
      channel: {
        id,
        team_id: workspace_id,
        name,
        display_name,
        type: 'D',
        dm_peer_id: peer_user_id,
        dm_peer_display: display_name
      }
    })
  }

  const display_name = String(body.display_name || '').trim()
  if (!display_name) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const name = slugifySegment(String(body.name || display_name), 'channel')
  const type = body.type === 'P' ? 'P' : 'O'
  const id = randomUUID()
  const now = Date.now()
  try {
    await pool.query(
      `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, workspace_id, name, display_name, type, now]
    )
    const channel = {
      id,
      team_id: workspace_id,
      name,
      display_name,
      type
    }
    return NextResponse.json({ channel })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'channel_name_taken' }, { status: 409 })
    }
    return NextResponse.json({ error: 'channel_create_failed' }, { status: 400 })
  }
}
