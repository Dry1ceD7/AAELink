import { NextRequest, NextResponse } from 'next/server'
import { readSessionUserId } from '@/lib/session'

/**
 * Typing Indicators API — ephemeral, in-memory (no DB persistence).
 *
 * POST /api/typing   { channel_id }              → broadcast "user is typing"
 * GET  /api/typing?channel_id=...                → poll who is typing
 *
 * Typing events expire after 5 seconds (Slack uses ~3s, we use 5s for tolerance).
 * In production, this would be backed by Redis pub/sub; for single-process this
 * works perfectly with a module-level Map.
 */

const TYPING_TTL_MS = 5_000

// channelId → Map<userId, lastTypingTimestamp>
const typingState = new Map<string, Map<string, number>>()

function pruneChannel(channelId: string): Map<string, number> {
  const users = typingState.get(channelId) || new Map<string, number>()
  const now = Date.now()
  for (const [uid, ts] of users) {
    if (now - ts > TYPING_TTL_MS) users.delete(uid)
  }
  if (users.size === 0) typingState.delete(channelId)
  return users
}

/** POST — mark the caller as "typing" in a channel. */
export async function POST(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  if (!typingState.has(channelId)) typingState.set(channelId, new Map())
  typingState.get(channelId)!.set(uid, Date.now())

  return NextResponse.json({ ok: true })
}

/** GET — return who is currently typing in a channel. */
export async function GET(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const users = pruneChannel(channelId)

  // Exclude the caller from the typing list
  const typingUserIds = [...users.keys()].filter(id => id !== uid)

  return NextResponse.json({ channel_id: channelId, typing: typingUserIds })
}
