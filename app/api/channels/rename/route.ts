import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { slugifySegment } from '@/lib/slug'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Channel Rename API — rename a channel with slug normalization.
 *
 * PATCH /api/channels/rename { channel_id, name?, display_name? }
 *
 * - Only channel admins or platform admins can rename channels.
 * - Name is slugified automatically.
 * - Posts a system message recording the rename.
 * - Default channels (#general) cannot be renamed.
 */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    name?: string
    display_name?: string
  }

  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Verify channel exists
  const { rows: chRows } = await pool.query<{
    name: string; display_name: string; workspace_id: string; is_default: boolean
  }>(`SELECT name, display_name, workspace_id, COALESCE(is_default, false) AS is_default
      FROM aaelink.channels WHERE id = $1`, [channelId])

  if (!chRows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })
  const channel = chRows[0]

  if (channel.is_default) {
    return NextResponse.json({ error: 'cannot_rename_default_channel' }, { status: 403 })
  }

  // Check membership + role
  const { rows: memberRows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  if (!memberRows[0]) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const isAdmin = memberRows[0].role === 'admin' ||
    ['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')

  if (!isAdmin) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const now = Date.now()
  const updates: string[] = []
  const params: (string | number)[] = []
  let idx = 1
  const oldName = channel.name
  const oldDisplay = channel.display_name

  if (body.name !== undefined) {
    const newName = slugifySegment(String(body.name).trim())
    if (!newName) return NextResponse.json({ error: 'invalid_name' }, { status: 400 })

    // Check uniqueness
    const { rows: dupRows } = await pool.query<{ id: string }>(
      `SELECT id FROM aaelink.channels WHERE workspace_id = $1 AND name = $2 AND id <> $3`,
      [channel.workspace_id, newName, channelId]
    )
    if (dupRows[0]) return NextResponse.json({ error: 'name_already_taken' }, { status: 409 })

    updates.push(`name = $${idx}`)
    params.push(newName)
    idx++
  }

  if (body.display_name !== undefined) {
    const newDisplay = String(body.display_name).trim().substring(0, 64)
    if (!newDisplay) return NextResponse.json({ error: 'invalid_display_name' }, { status: 400 })
    updates.push(`display_name = $${idx}`)
    params.push(newDisplay)
    idx++
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  }

  updates.push(`updated_at = $${idx}`)
  params.push(now)
  idx++
  params.push(channelId)

  await pool.query(
    `UPDATE aaelink.channels SET ${updates.join(', ')} WHERE id = $${idx - 1 + 1}`,
    params
  )

  // Fix: just use separate param index
  const finalName = body.name !== undefined ? slugifySegment(String(body.name).trim()) : oldName
  const finalDisplay = body.display_name !== undefined ? String(body.display_name).trim().substring(0, 64) : oldDisplay

  // Correct update
  await pool.query(
    `UPDATE aaelink.channels SET name = $1, display_name = $2, updated_at = $3 WHERE id = $4`,
    [finalName, finalDisplay, now, channelId]
  )

  // System message
  const { rows: userRows } = await pool.query<{ username: string }>(
    `SELECT username FROM aaelink.users WHERE id = $1`, [uid]
  )
  const username = userRows[0]?.username || 'someone'

  const { randomUUID } = await import('crypto')
  if (finalName !== oldName) {
    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, '', $5, $5)
    `, [randomUUID(), channelId, uid,
        `**@${username}** renamed this channel from **#${oldName}** to **#${finalName}**`,
        now]).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    channel_id: channelId,
    old_name: oldName,
    new_name: finalName,
    old_display_name: oldDisplay,
    new_display_name: finalDisplay
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const PATCH  = tracedRoute('PATCH', '/api/channels/rename', _PATCH)
