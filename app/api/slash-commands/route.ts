// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { signPayload, generateSigningSecret } from '@/lib/webhooks/webhookSigning'
import { mintResponseToken } from '@/lib/comms/slashResponseToken'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import {
  normalizeHostname,
  assertSafeCallbackUrl,
  assertCallbackHostResolvesPublic,
} from '@/lib/security/ssrfGuard'

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

  // SSRF guard — reject non-https and private/loopback targets at registration time
  const urlCheck = assertSafeCallbackUrl(callbackUrl)
  if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 })

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
  const signingSecret = generateSigningSecret()
  const now = Date.now()

  try {
    await pool.query(
      `INSERT INTO aaelink.slash_commands (id, workspace_id, name, description, usage_hint, callback_url, signing_secret, is_active, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
      [id, workspaceId, name, description, usageHint, callbackUrl, signingSecret, uid, now]
    )
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'command_name_taken' }, { status: 409 })
    }
    throw e
  }

  // Audit log — best-effort, must not fail the request (Hard Rule #5)
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, 'slash_command.register', $4, $5, $6)`,
      [randomUUID(), workspaceId, uid, id, JSON.stringify({ command: name, callback_url_host: urlCheck.url.host }), now]
    )
  } catch { /* audit log is best-effort */ }

  // signing_secret is returned once here — not included in subsequent LIST responses
  return NextResponse.json({
    command: { id, name, description, usage_hint: usageHint, callback_url: callbackUrl },
    signing_secret: signingSecret,
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
  const wsId = String(body.workspace_id || '').trim()

  if (!command) return NextResponse.json({ error: 'command_required' }, { status: 400 })

  // Cross-tenant authz: when a workspace is targeted, the caller MUST be a member
  // of it. Without this, any authenticated user could trigger a signed outbound
  // POST to another workspace's custom-command callback (or mutate its channels).
  if (wsId) {
    const { rows: member } = await pool.query(
      `SELECT 1 FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [wsId, uid]
    )
    if (member.length === 0) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

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
      if (!channelId) return NextResponse.json({ response_type: 'ephemeral', text: 'No channel context' })
      // Channel-level authz: only members of (or readers of) the channel may
      // list its members. Unauthorized callers get the SAME response as an
      // unknown channel so this never reveals whether the channel exists.
      if (!(await userCanReadChannel(pool, uid, channelId))) {
        return NextResponse.json({ response_type: 'ephemeral', text: 'No channel context' })
      }
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
      if (!channelId) return NextResponse.json({ response_type: 'ephemeral', text: 'No channel context' })
      if (!text) return NextResponse.json({ response_type: 'ephemeral', text: 'Usage: /topic [new topic]' })
      await pool.query(`UPDATE aaelink.channels SET purpose = $1 WHERE id = $2`, [text.slice(0, 500), channelId])
      return NextResponse.json({
        response_type: 'in_channel',
        text: `📌 Channel topic updated: ${text.slice(0, 500)}`
      })
    }

    default: {
      // Try custom commands (workspace membership already asserted above)
      if (wsId) {
        const { rows: custom } = await pool.query<{ callback_url: string; signing_secret: string }>(
          `SELECT callback_url, signing_secret FROM aaelink.slash_commands WHERE workspace_id = $1 AND name = $2 AND is_active = true`,
          [wsId, command]
        )
        if (custom[0]?.callback_url) {
          return dispatchCustomCommand(pool, {
            callbackUrl: custom[0].callback_url,
            signingSecret: custom[0].signing_secret,
            command,
            text,
            userId: uid,
            channelId,
            workspaceId: wsId,
          })
        }
      }

      return NextResponse.json({
        response_type: 'ephemeral',
        text: `Unknown command: /${command}. Type /help for available commands.`
      })
    }
  }
}

/** Write a best-effort audit row for a dispatch attempt (must not throw). */
async function auditDispatch(
  pool: import('pg').Pool,
  opts: { workspaceId: string; userId: string; command: string; channelId: string; status: number | string },
) {
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, 'slash_command.dispatch', $4, $5, $6)`,
      [
        randomUUID(),
        opts.workspaceId,
        opts.userId,
        opts.command,
        JSON.stringify({ command: `/${opts.command}`, channel_id: opts.channelId, status: opts.status }),
        Date.now(),
      ]
    )
  } catch { /* audit log is best-effort */ }
}

/** POST a Slack-shaped payload to the custom command's callback_url, signed with HMAC. */
async function dispatchCustomCommand(
  pool: import('pg').Pool,
  opts: {
    callbackUrl: string
    signingSecret: string
    command: string
    text: string
    userId: string
    channelId: string
    workspaceId: string
  },
): Promise<NextResponse> {
  const { callbackUrl, signingSecret, command, text, userId, channelId, workspaceId } = opts

  // SSRF guard at dispatch time too (defense-in-depth: callback_url may have been
  // stored before this guard existed)
  const urlCheck = assertSafeCallbackUrl(callbackUrl)
  if (!urlCheck.ok) {
    await auditDispatch(pool, { workspaceId, userId, command, channelId, status: urlCheck.error })
    return NextResponse.json({ response_type: 'ephemeral', text: `Command delivery failed: ${urlCheck.error}` })
  }

  // DNS-resolve the host and reject if it maps to private/loopback/link-local/
  // metadata space. See assertCallbackHostResolvesPublic for the residual
  // DNS-rebinding TOCTOU caveat.
  const dnsCheck = await assertCallbackHostResolvesPublic(normalizeHostname(urlCheck.url.hostname))
  if (!dnsCheck.ok) {
    await auditDispatch(pool, { workspaceId, userId, command, channelId, status: dnsCheck.error })
    return NextResponse.json({ response_type: 'ephemeral', text: `Command delivery failed: ${dnsCheck.error}` })
  }

  // Mint a signed, single-channel-scoped, expiring response_url so the external
  // app can POST delayed/async replies back into THIS channel (Slack parity §14:
  // up to 5 uses within ~30 min). The token binds channel/user/command/workspace
  // and is consumed by POST /api/slash-commands/response. Best-effort: a mint
  // failure must not block the synchronous dispatch (response_url falls back to
  // null, matching prior behavior).
  let responseUrl: string | null = null
  try {
    const token = await mintResponseToken(pool, { channelId, userId, command, workspaceId })
    const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || ''
    responseUrl = `${base}/api/slash-commands/response?token=${encodeURIComponent(token)}`
  } catch { /* response_url remains null when the token store is unavailable */ }

  // Compute the timestamp once so the payload's `ts` matches the value the
  // signature covers (signPayload signs `body`, which embeds this same ts).
  const ts = Math.floor(Date.now() / 1000)
  const payload = {
    command: `/${command}`,
    text,
    user_id: userId,
    channel_id: channelId,
    workspace_id: workspaceId,
    response_url: responseUrl,
    ts: String(ts),
  }
  const body = JSON.stringify(payload)
  const { headers } = signPayload(signingSecret, body, ts)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    })

    clearTimeout(timer)

    await auditDispatch(pool, { workspaceId, userId, command, channelId, status: res.status })

    if (!res.ok) {
      return NextResponse.json({
        response_type: 'ephemeral',
        text: `Command delivery failed (HTTP ${res.status})`,
      })
    }

    const json = (await res.json().catch(() => null)) as {
      response_type?: string
      text?: string
    } | null

    const responseType = json?.response_type === 'in_channel' ? 'in_channel' : 'ephemeral'
    const responseText = typeof json?.text === 'string' ? json.text : `/${command} executed`
    return NextResponse.json({ response_type: responseType, text: responseText })
  } catch (err: unknown) {
    clearTimeout(timer)
    const isTimeout = (err as { name?: string })?.name === 'AbortError'
    await auditDispatch(pool, { workspaceId, userId, command, channelId, status: isTimeout ? 'timeout' : 'network_error' })
    return NextResponse.json({
      response_type: 'ephemeral',
      text: isTimeout
        ? `Command delivery timed out`
        : `Command delivery failed (network error)`,
    })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/slash-commands', _GET)
export const POST   = tracedRoute('POST', '/api/slash-commands', _POST)
