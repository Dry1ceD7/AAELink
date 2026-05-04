import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { randomUUID } from 'crypto'

// Public receiver for Incoming Webhooks.
// External systems (HR, Finance, Jira, etc.) POST to /api/webhooks/{secret_token}
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const { token } = await params

  try {
    // 1. Verify token
    const { rows: webhooks } = await pool.query(
      `SELECT w.*, a.name as app_name, a.icon_url as app_icon 
       FROM aaelink.incoming_webhooks w
       LEFT JOIN aaelink.apps a ON w.app_id = a.id
       WHERE w.secret_token = $1 LIMIT 1`,
      [token]
    )

    if (webhooks.length === 0) {
      return NextResponse.json({ error: 'Invalid webhook token' }, { status: 401 })
    }

    const webhook = webhooks[0]

    // 2. Parse payload (Slack/Mattermost compatible payload: { text: "...", attachments: [...] })
    const body = await req.json()
    const { text, username, icon_url } = body

    if (!text) {
      return NextResponse.json({ error: 'Payload must contain "text" field' }, { status: 400 })
    }

    const messageId = randomUUID()
    const now = Date.now()

    // Create the message in the channel
    // We attribute the message to a "System" user if it's a webhook, but add metadata
    const botName = username || webhook.app_name || webhook.name
    const botIcon = icon_url || webhook.app_icon || ''

    await pool.query(
      `INSERT INTO aaelink.messages (id, workspace_id, channel_id, user_id, content, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        messageId, 
        webhook.workspace_id, 
        webhook.channel_id, 
        webhook.created_by, // Fallback to creator's ID, but metadata marks it as bot
        text, 
        now, 
        JSON.stringify({ 
          is_bot: true, 
          bot_name: botName, 
          bot_icon: botIcon,
          webhook_id: webhook.id
        })
      ]
    )

    // Fire SSE notification so connected clients see the new message
    await pool.query(
      `INSERT INTO aaelink.notifications (id, workspace_id, user_id, type, target_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        webhook.workspace_id,
        'SYSTEM',
        'new_message',
        webhook.channel_id,
        JSON.stringify({ message_id: messageId }),
        now
      ]
    )

    return NextResponse.json({ success: true, message: 'ok' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
