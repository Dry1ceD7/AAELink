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
  const channelAccessFilter = `(
    c.type = 'O'
    OR (c.type = 'D' AND (c.dm_user_a = $1::text OR c.dm_user_b = $1::text))
    OR (c.type IN ('P', 'G') AND EXISTS (
      SELECT 1 FROM aaelink.channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $1::text
    ))
  )`

  await pool.query(
    `INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
     SELECT $1::text, c.id, COALESCE(MAX(m.created_at), 0)::bigint
     FROM aaelink.channels c
     LEFT JOIN aaelink.messages m ON m.channel_id = c.id AND ${rootFilter}
     WHERE c.workspace_id = $2::text
       AND ${channelAccessFilter}
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
    purpose: string
    header: string
  }>(
    `SELECT c.id, c.workspace_id AS team_id, c.name, c.display_name, c.type,
            c.purpose, c.header,
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
       AND ${channelAccessFilter}
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
        ...(dm_peer_id ? { dm_peer_id, dm_peer_display } : {}),
        purpose: r.purpose || '',
        header: r.header || ''
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
    purpose?: string
    peer_user_id?: string
    peer_user_ids?: string[]
  }
  const workspace_id = String(body.workspace_id || body.team_id || '')
  if (!workspace_id) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  if (!(await assertWorkspaceMember(pool, uid, workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const peer_user_id = String(body.peer_user_id || '').trim()
  const rawPeers = Array.isArray(body.peer_user_ids) ? body.peer_user_ids.map(String).filter(Boolean) : (peer_user_id ? [peer_user_id] : [])
  const peer_user_ids = [...new Set(rawPeers)]

  if (peer_user_ids.length > 0) {
    if (peer_user_ids.length === 1 && peer_user_ids[0] === uid) {
      return NextResponse.json({ error: 'invalid_peer' }, { status: 400 })
    }
    const { rows: peerMem } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = ANY($2::text[])`,
      [workspace_id, peer_user_ids]
    )
    if (peerMem.length !== peer_user_ids.length) {
      return NextResponse.json({ error: 'peer_not_in_workspace' }, { status: 400 })
    }

    const allIds = Array.from(new Set([uid, ...peer_user_ids])).sort()
    
    if (allIds.length <= 2) {
      // Normal DM (1:1)
      const actualPeer = allIds.find(id => id !== uid) || uid
      const dm_user_a = uid < actualPeer ? uid : actualPeer
      const dm_user_b = uid < actualPeer ? actualPeer : uid

      const { rows: existing } = await pool.query<{
        id: string; name: string; display_name: string; type: string
      }>(
        `SELECT id, name, display_name, type FROM aaelink.channels
         WHERE workspace_id = $1 AND type = 'D' AND dm_user_a = $2 AND dm_user_b = $3`,
        [workspace_id, dm_user_a, dm_user_b]
      )
      if (existing[0]) {
        return NextResponse.json({ channel: { ...existing[0], team_id: workspace_id, dm_peer_id: actualPeer } })
      }

      const { rows: peerRows } = await pool.query<{ username: string; first_name: string | null; last_name: string | null; nickname: string | null }>(
        `SELECT username, first_name, last_name, nickname FROM aaelink.users WHERE id = $1`, [actualPeer]
      )
      const display_name = peerRows[0] ? peerDisplayName(peerRows[0]) : 'Direct Message'
      const id = randomUUID()
      const name = `dm-${id.replace(/-/g, '').slice(0, 20)}`
      const now = Date.now()
      try {
        await pool.query(
          `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at, dm_user_a, dm_user_b)
           VALUES ($1, $2, $3, $4, 'D', $5, $6, $7)`,
          [id, workspace_id, name, display_name, now, dm_user_a, dm_user_b]
        )
      } catch (e: any) {
        if (e.code === '23505') {
          const { rows: again } = await pool.query<{ id: string; name: string; display_name: string; type: string }>(
            `SELECT id, name, display_name, type FROM aaelink.channels WHERE workspace_id = $1 AND type = 'D' AND dm_user_a = $2 AND dm_user_b = $3`,
            [workspace_id, dm_user_a, dm_user_b]
          )
          if (again[0]) return NextResponse.json({ channel: { ...again[0], team_id: workspace_id, dm_peer_id: actualPeer } })
        }
        throw e
      }
      return NextResponse.json({ channel: { id, team_id: workspace_id, name, display_name, type: 'D', dm_peer_id: actualPeer, dm_peer_display: display_name } })
    } else {
      // Group DM (MPDM)
      const crypto = require('crypto')
      const nameHash = crypto.createHash('sha256').update(allIds.join(',')).digest('hex').slice(0, 40)
      const name = `mpdm-${nameHash}`
      
      const { rows: existing } = await pool.query<{ id: string; name: string; display_name: string; type: string }>(
        `SELECT id, name, display_name, type FROM aaelink.channels WHERE workspace_id = $1 AND name = $2 AND type = 'G'`,
        [workspace_id, name]
      )
      if (existing[0]) return NextResponse.json({ channel: { ...existing[0], team_id: workspace_id } })

      const { rows: peerRows } = await pool.query<{ id: string; username: string; first_name: string | null; last_name: string | null; nickname: string | null }>(
        `SELECT id, username, first_name, last_name, nickname FROM aaelink.users WHERE id = ANY($1::text[])`, [allIds]
      )
      const peerDisplayNames = peerRows.filter(p => p.id !== uid).map(p => peerDisplayName(p))
      const display_name = peerDisplayNames.join(', ').slice(0, 255)
      
      const id = randomUUID()
      const now = Date.now()
      try {
        await pool.query('BEGIN')
        await pool.query(
          `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_at)
           VALUES ($1, $2, $3, $4, 'G', $5)`,
          [id, workspace_id, name, display_name, now]
        )
        for (const memberId of allIds) {
          await pool.query(
            `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`,
            [id, memberId, now]
          )
        }
        await pool.query('COMMIT')
        return NextResponse.json({ channel: { id, team_id: workspace_id, name, display_name, type: 'G' } })
      } catch (e: any) {
        await pool.query('ROLLBACK')
        if (e.code === '23505') {
          const { rows: again } = await pool.query<{ id: string; name: string; display_name: string; type: string }>(
            `SELECT id, name, display_name, type FROM aaelink.channels WHERE workspace_id = $1 AND name = $2 AND type = 'G'`,
            [workspace_id, name]
          )
          if (again[0]) return NextResponse.json({ channel: { ...again[0], team_id: workspace_id } })
        }
        throw e
      }
    }
  }

  const display_name = String(body.display_name || '').trim()
  if (!display_name) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const name = slugifySegment(String(body.name || display_name), 'channel')
  const type = body.type === 'P' ? 'P' : 'O'
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim().slice(0, 500) : ''
  const id = randomUUID()
  const now = Date.now()
  try {
    await pool.query('BEGIN')
    await pool.query(
      `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, purpose, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, workspace_id, name, display_name, type, purpose, now]
    )
    await pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'admin', $3)`,
      [id, uid, now]
    )
    await pool.query('COMMIT')
    
    const channel = {
      id,
      team_id: workspace_id,
      name,
      display_name,
      type
    }
    return NextResponse.json({ channel })
  } catch (e: unknown) {
    await pool.query('ROLLBACK')
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'channel_name_taken' }, { status: 409 })
    }
    return NextResponse.json({ error: 'channel_create_failed' }, { status: 400 })
  }
}

/** PATCH /api/channels — archive or unarchive a channel.  Body: { channel_id, action: 'archive' | 'unarchive' } */
export async function PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    action?: 'archive' | 'unarchive'
    purpose?: string
    header?: string
  }
  const channelId = String(body.channel_id || '').trim()
  const action = body.action

  if (!channelId) {
    return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  }

  // Topic / header update (no archive action)
  if (!action && (body.purpose !== undefined || body.header !== undefined)) {
    const { rows: chRows } = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
    )
    if (!chRows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })
    if (!(await assertWorkspaceMember(pool, uid, chRows[0].workspace_id))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    if (body.purpose !== undefined) {
      await pool.query(`UPDATE aaelink.channels SET purpose = $1 WHERE id = $2`, [body.purpose.slice(0, 500), channelId])
    }
    if (body.header !== undefined) {
      await pool.query(`UPDATE aaelink.channels SET header = $1 WHERE id = $2`, [body.header.slice(0, 1000), channelId])
    }
    return NextResponse.json({ ok: true })
  }

  if (!action || (action !== 'archive' && action !== 'unarchive')) {
    return NextResponse.json({ error: 'valid_action_required' }, { status: 400 })
  }

  // Verify channel exists and user has access
  const { rows: chRows } = await pool.query<{ workspace_id: string; type: string }>(
    `SELECT workspace_id, type FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  const ch = chRows[0]
  if (!ch) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  // Don't allow archiving DM channels
  if (ch.type === 'D') {
    return NextResponse.json({ error: 'cannot_archive_dm' }, { status: 400 })
  }

  if (action === 'archive') {
    await pool.query(
      `UPDATE aaelink.channels SET archived_at = $1 WHERE id = $2`,
      [Date.now(), channelId]
    )
  } else {
    await pool.query(
      `UPDATE aaelink.channels SET archived_at = 0 WHERE id = $1`,
      [channelId]
    )
  }

  return NextResponse.json({ ok: true, action })
}
