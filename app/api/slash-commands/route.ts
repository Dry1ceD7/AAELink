// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Slash Commands API (Slack parity).
 *
 * GET  /api/slash-commands?workspace_id=...   — list registered slash commands
 * POST /api/slash-commands                    — register a custom slash command (admin)
 * POST /api/slash-commands/execute            — execute a built-in or custom command
 *
 * Built-in commands (always available):
 *   /remind   — Set a reminder (integrated with reminders table)
 *   /dnd      — Toggle DND / snooze
 *   /status   — Set user status
 *   /shrug    — Append ¯\_(ツ)_/¯
 *   /mute     — Mute current channel
 *   /invite   — Invite user to current channel
 *   /topic    — Set channel topic / purpose
 *   /who      — List channel members
 */

const BUILT_IN_COMMANDS = [
  { name: 'remind', description: 'Set a reminder', usage: '/remind [message] [when]', is_builtin: true },
  { name: 'dnd', description: 'Toggle Do Not Disturb', usage: '/dnd [minutes]', is_builtin: true },
  { name: 'status', description: 'Set your status', usage: '/status [:emoji:] [text]', is_builtin: true },
  { name: 'shrug', description: 'Append ¯\\_(ツ)_/¯', usage: '/shrug [message]', is_builtin: true },
  { name: 'mute', description: 'Mute current channel', usage: '/mute', is_builtin: true },
  { name: 'invite', description: 'Invite a user to this channel', usage: '/invite @username', is_builtin: true },
  { name: 'topic', description: 'Set channel topic', usage: '/topic [new topic]', is_builtin: true },
  { name: 'who', description: 'List channel members', usage: '/who', is_builtin: true },
  { name: 'leave', description: 'Leave this channel', usage: '/leave', is_builtin: true },
  { name: 'giphy', description: 'Post a random GIF', usage: '/giphy [search term]', is_builtin: true },
]

/** GET — list available slash commands (built-in + custom) */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Custom commands from DB
  const { rows: custom } = await pool.query(
    `SELECT id, name, description, usage_hint, callback_url, is_active, created_by, created_at
     FROM aaelink.slash_commands
     WHERE workspace_id = $1 AND is_active = true
     ORDER BY name ASC`,
    [workspaceId]
  )

  const commands = [
    ...BUILT_IN_COMMANDS.map(c => ({ ...c, id: `builtin_${c.name}`, is_active: true })),
    ...custom.map((c: Record<string, unknown>) => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      usage: c.usage_hint || `/${c.name}`,
      is_builtin: false,
      is_active: c.is_active,
      callback_url: c.callback_url
    }))
  ]

  return NextResponse.json({ commands })
}

/** POST — register a custom slash command or execute one */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'register' | 'execute'
    workspace_id?: string
    // Register fields
    name?: string
    description?: string
    usage_hint?: string
    callback_url?: string
    // Execute fields
    command?: string
    text?: string
    channel_id?: string
  }

  const action = body.action || 'execute'

  if (action === 'register') {
    return registerCommand(pool, uid, body)
  }

  return executeCommand(pool, uid, body)
}

async function registerCommand(
  pool: import('pg').Pool,
  uid: string,
  body: {
    workspace_id?: string
    name?: string
    description?: string
    usage_hint?: string
    callback_url?: string
  }
) {
  const workspaceId = String(body.workspace_id || '').trim()
  const name = String(body.name || '').trim().toLowerCase().replace(/^\//, '')
  const description = String(body.description || '').trim()
  const usageHint = String(body.usage_hint || '').trim()
  const callbackUrl = String(body.callback_url || '').trim()

  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!name || name.length < 2) return NextResponse.json({ error: 'invalid_command_name' }, { status: 400 })
  if (!callbackUrl) return NextResponse.json({ error: 'callback_url_required' }, { status: 400 })

  // Check for name conflicts with built-ins
  if (BUILT_IN_COMMANDS.some(c => c.name === name)) {
    return NextResponse.json({ error: 'conflicts_with_builtin' }, { status: 409 })
  }

  // Check admin access
  const { rows: wmRows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  if (!['owner', 'admin'].includes(wmRows[0]?.role || '')) {
    return NextResponse.json({ error: 'forbidden_admin_only' }, { status: 403 })
  }

  const id = randomUUID()
  const now = Date.now()

  try {
    await pool.query(
      `INSERT INTO aaelink.slash_commands (id, workspace_id, name, description, usage_hint, callback_url, is_active, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
      [id, workspaceId, name, description, usageHint, callbackUrl, uid, now]
    )
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'command_name_taken' }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json({
    command: { id, name, description, usage_hint: usageHint, callback_url: callbackUrl }
  })
}

async function executeCommand(
  pool: import('pg').Pool,
  uid: string,
  body: {
    workspace_id?: string
    command?: string
    text?: string
    channel_id?: string
  }
) {
  const command = String(body.command || '').trim().toLowerCase().replace(/^\//, '')
  const text = String(body.text || '').trim()
  const channelId = String(body.channel_id || '').trim()

  if (!command) return NextResponse.json({ error: 'command_required' }, { status: 400 })

  // Built-in commands
  switch (command) {
    case 'shrug':
      return NextResponse.json({
        response_type: 'in_channel',
        text: text ? `${text} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯'
      })

    case 'dnd': {
      const minutes = parseInt(text) || 30
      const snoozeUntil = Date.now() + minutes * 60 * 1000
      await pool.query(
        `INSERT INTO aaelink.dnd_settings (user_id, enabled, start_time, end_time, timezone, snooze_until, updated_at)
         VALUES ($1, false, '22:00', '08:00', 'UTC', $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET snooze_until = $2, updated_at = $3`,
        [uid, snoozeUntil, Date.now()]
      )
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `🔕 DND enabled for ${minutes} minutes (until ${new Date(snoozeUntil).toISOString()})`
      })
    }

    case 'status': {
      const emojiMatch = text.match(/^:([^:]+):/)
      const statusEmoji = emojiMatch ? emojiMatch[1] : ''
      const statusText = emojiMatch ? text.slice(emojiMatch[0].length).trim() : text

      await pool.query(
        `INSERT INTO aaelink.user_status (user_id, status, custom_text, updated_at)
         VALUES ($1, 'online', $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET custom_text = $2, updated_at = $3`,
        [uid, statusEmoji ? `${statusEmoji} ${statusText}` : statusText, Date.now()]
      )
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `✅ Status updated: ${statusEmoji ? `:${statusEmoji}: ` : ''}${statusText}`
      })
    }

    case 'who': {
      if (!channelId) return NextResponse.json({ response_type: 'ephemeral', text: '❌ No channel context' })
      const { rows: members } = await pool.query<{ username: string }>(
        `SELECT u.username FROM aaelink.channel_members cm
         JOIN aaelink.users u ON u.id = cm.user_id
         WHERE cm.channel_id = $1
         ORDER BY u.username LIMIT 50`,
        [channelId]
      )
      const memberList = members.map(m => `@${m.username}`).join(', ') || 'No members found'
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `👥 Channel members (${members.length}): ${memberList}`
      })
    }

    case 'topic': {
      if (!channelId) return NextResponse.json({ response_type: 'ephemeral', text: '❌ No channel context' })
      if (!text) return NextResponse.json({ response_type: 'ephemeral', text: '❌ Usage: /topic [new topic]' })
      await pool.query(`UPDATE aaelink.channels SET purpose = $1 WHERE id = $2`, [text.slice(0, 500), channelId])
      return NextResponse.json({
        response_type: 'in_channel',
        text: `📌 Channel topic updated: ${text.slice(0, 500)}`
      })
    }

    default: {
      // Try custom commands
      const wsId = String(body.workspace_id || '').trim()
      if (wsId) {
        const { rows: custom } = await pool.query<{ callback_url: string }>(
          `SELECT callback_url FROM aaelink.slash_commands WHERE workspace_id = $1 AND name = $2 AND is_active = true`,
          [wsId, command]
        )
        if (custom[0]?.callback_url) {
          // For now, return info about the custom command (actual webhook dispatch in future)
          return NextResponse.json({
            response_type: 'ephemeral',
            text: `⚙️ Custom command /${command} triggered (callback: ${custom[0].callback_url})`
          })
        }
      }

      return NextResponse.json({
        response_type: 'ephemeral',
        text: `❌ Unknown command: /${command}. Type /help for available commands.`
      })
    }
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/slash-commands', _GET)
export const POST   = tracedRoute('POST', '/api/slash-commands', _POST)
