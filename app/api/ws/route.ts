/**
 * AAELink — WebSocket Gateway API Route
 *
 * Server-side WebSocket endpoint that works alongside the existing SSE transport.
 * Clients negotiate: try WS first, fall back to SSE `/api/collab/events`.
 *
 * Protocol:
 *   - subscribe/unsubscribe: room management
 *   - ping/pong: heartbeat
 *   - message/typing/reaction/deletion: forwarded via PubSub
 *
 * This route uses the Web API Response with upgrade headers.
 * In Next.js 16 on Node.js runtime, WebSocket upgrade is supported
 * via the server.upgrade() pattern or a custom server adapter.
 *
 * For development: this route returns a 426 Upgrade Required response
 * to signal that the WS gateway should be deployed as a standalone
 * service (e.g., a separate Node.js process or k8s sidecar).
 *
 * Production deployments should run the WS fleet as a separate service
 * that shares the Redis Pub/Sub bus with the Next.js API tier.
 */

import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'
import { getPubSub, channelTopic, type PubSubEvent } from '@/lib/redisPubSub'

// ── Types ────────────────────────────────────────────────────────────

interface WsFrame {
  type: string
  seq?: number
  channel_id?: string
  user_id?: string
  payload?: unknown
  ts?: number
}

// ── GET: Connection info / health ────────────────────────────────────

async function _GET(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const pubsub = getPubSub()
  const upgradeHeader = req.headers.get('upgrade')

  // If this is a WebSocket upgrade request
  if (upgradeHeader?.toLowerCase() === 'websocket') {
    // Next.js App Router doesn't natively support WebSocket upgrade.
    // Return 426 to signal clients should use the dedicated WS gateway.
    return Response.json(
      {
        error: 'ws_upgrade_not_supported_here',
        message: 'WebSocket connections should use the dedicated WS gateway service.',
        fallback: '/api/collab/events',
        transport: 'sse',
      },
      { status: 426 }
    )
  }

  // Standard GET: return transport capabilities
  return Response.json({
    transports: {
      sse: {
        url: '/api/collab/events',
        status: 'available',
      },
      websocket: {
        url: process.env.WS_GATEWAY_URL || null,
        status: process.env.WS_GATEWAY_URL ? 'available' : 'not_configured',
      },
      polling: {
        url: '/api/messages',
        status: 'available',
      },
    },
    pubsub: {
      backend: pubsub.backend,
      connected: pubsub.isConnected(),
      subscriptions: pubsub.subscriptionCount(),
    },
    user_id: uid,
  })
}

// ── POST: Publish events via PubSub (internal service bus) ──────────

async function _POST(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let frame: WsFrame
  try {
    frame = (await req.json()) as WsFrame
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!frame.type) {
    return Response.json({ error: 'type_required' }, { status: 400 })
  }

  const pubsub = getPubSub()
  const channelId = frame.channel_id || ''

  // Route events to the appropriate PubSub topic
  switch (frame.type) {
    case 'message': {
      if (!channelId) {
        return Response.json({ error: 'channel_id_required' }, { status: 400 })
      }
      const event: PubSubEvent = {
        type: 'message',
        channel_id: channelId,
        payload: frame.payload,
      }
      await pubsub.publish(channelTopic(channelId), event)
      return Response.json({ ok: true, published: true })
    }

    case 'typing': {
      if (!channelId) {
        return Response.json({ error: 'channel_id_required' }, { status: 400 })
      }
      const event: PubSubEvent = {
        type: 'typing',
        channel_id: channelId,
        user_id: uid,
        active: (frame.payload as { active?: boolean })?.active !== false,
      }
      await pubsub.publish(channelTopic(channelId), event)
      return Response.json({ ok: true, published: true })
    }

    case 'reaction': {
      if (!channelId) {
        return Response.json({ error: 'channel_id_required' }, { status: 400 })
      }
      const p = frame.payload as {
        message_id?: string
        emoji?: string
        action?: 'add' | 'remove'
      }
      if (!p?.message_id || !p?.emoji) {
        return Response.json({ error: 'message_id_and_emoji_required' }, { status: 400 })
      }
      const event: PubSubEvent = {
        type: 'reaction',
        channel_id: channelId,
        message_id: p.message_id,
        emoji: p.emoji,
        user_id: uid,
        action: p.action || 'add',
      }
      await pubsub.publish(channelTopic(channelId), event)
      return Response.json({ ok: true, published: true })
    }

    default:
      return Response.json(
        { error: 'unknown_event_type', type: frame.type },
        { status: 400 }
      )
  }
}

// ── Traced exports ──────────────────────────────────────────────────

export const GET = tracedRoute('GET', '/api/ws', _GET)
export const POST = tracedRoute('POST', '/api/ws', _POST)
