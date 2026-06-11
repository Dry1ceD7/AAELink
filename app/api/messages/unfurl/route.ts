import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { unfurlUrl, generateUnfurlBlocks } from '@/lib/messaging/unfurl'

/**
 * POST /api/messages/unfurl — unfurl URLs in a message.
 *
 * Body: { channel_id, message_id, unfurls: [{ url }] }
 */

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    channel_id?: string; message_id?: string
    unfurls?: Array<{ url: string }>
  }

  if (!body.channel_id || !body.message_id || !Array.isArray(body.unfurls)) {
    return NextResponse.json({ error: 'channel_id_message_id_unfurls_required' }, { status: 400 })
  }

  const results: Record<string, unknown> = {}

  for (const item of body.unfurls.slice(0, 5)) {
    if (!item.url) continue
    const metadata = await unfurlUrl(item.url)
    const blocks = generateUnfurlBlocks(metadata)
    results[item.url] = { metadata, blocks }
  }

  // Store unfurl results on the message
  try {
    await pool.query(
      `UPDATE aaelink.messages SET unfurls = $1 WHERE id = $2 AND channel_id = $3`,
      [JSON.stringify(results), body.message_id, body.channel_id]
    )
  } catch { /* unfurls column may not exist yet — best-effort */ }

  return NextResponse.json({ ok: true, unfurls: results })
}

export const POST = tracedRoute('POST', '/api/messages/unfurl', _POST)
