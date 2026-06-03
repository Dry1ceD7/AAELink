import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { listMessageEdits } from '@/lib/messaging/messageEdits'

/**
 * GET /api/messages/:id/edits (D3) — a message's edit history (prior bodies),
 * newest first. Visible to anyone who can read the message's channel.
 */
async function _GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: messageId } = await ctx.params
  if (!messageId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })

  const { rows } = await pool.query<{ channel_id: string }>(
    `SELECT channel_id FROM aaelink.messages WHERE id = $1`,
    [messageId]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await userCanReadChannel(pool, uid, row.channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const edits = await listMessageEdits(pool, messageId)
  return NextResponse.json({ edits, total: edits.length, edited: edits.length > 0 })
}

// ── Traced export ───────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/messages/:id/edits', _GET)
