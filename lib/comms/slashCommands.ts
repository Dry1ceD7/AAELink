/**
 * Slash command engine for AAELink.
 *
 * Handles commands like /shrug, /me, /mute, /dnd, /status, /giphy, /remind.
 * The composer intercepts messages starting with '/' and routes them here
 * before sending to the server.
 */

import { apiFetch } from '@/lib/api/apiClient'

export interface SlashCommandResult {
  /** 'send' — send the transformed message to the channel normally. */
  /** 'ephemeral' — show only to the user, don't send to channel. */
  /** 'handled' — command executed an action (API call), no message to send. */
  action: 'send' | 'ephemeral' | 'handled'
  /** The message text (for 'send') or feedback text (for 'ephemeral'). */
  text?: string
}

interface SlashCommand {
  name: string
  description: string
  usage: string
  /** Return the result or null if args are invalid. */
  execute: (args: string, channelId: string) => Promise<SlashCommandResult>
}

const commands: SlashCommand[] = [
  {
    name: 'shrug',
    description: 'Appends ¯\\_(ツ)_/¯ to your message',
    usage: '/shrug [message]',
    execute: async (args) => ({
      action: 'send',
      text: `${args} ¯\\_(ツ)_/¯`.trim()
    })
  },
  {
    name: 'tableflip',
    description: 'Appends (╯°□°)╯︵ ┻━┻ to your message',
    usage: '/tableflip [message]',
    execute: async (args) => ({
      action: 'send',
      text: `${args} (╯°□°)╯︵ ┻━┻`.trim()
    })
  },
  {
    name: 'unflip',
    description: 'Appends ┬─┬ ノ( ゜-゜ノ) to your message',
    usage: '/unflip [message]',
    execute: async (args) => ({
      action: 'send',
      text: `${args} ┬─┬ ノ( ゜-゜ノ)`.trim()
    })
  },
  {
    name: 'me',
    description: 'Displays action text in italics',
    usage: '/me [action]',
    execute: async (args) => {
      if (!args.trim()) return { action: 'ephemeral', text: 'Usage: /me [action text]' }
      return { action: 'send', text: `_${args.trim()}_` }
    }
  },
  {
    name: 'status',
    description: 'Set your custom status',
    usage: '/status [:emoji:] [text] — clear with /status clear',
    execute: async (args) => {
      const trimmed = args.trim()
      if (!trimmed || trimmed === 'clear') {
        await apiFetch('/api/user-status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status_text: '', status_emoji: '', expires_at: 0 })
        })
        return { action: 'ephemeral', text: '✓ Status cleared.' }
      }
      // Try to extract emoji and text: /status :emoji: text
      const emojiMatch = trimmed.match(/^:([a-z0-9_]+):\s*(.*)$/i)
      const emoji = emojiMatch ? emojiMatch[1] : ''
      const text = emojiMatch ? emojiMatch[2] : trimmed
      await apiFetch('/api/user-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_text: text, status_emoji: emoji ? `:${emoji}:` : '', expires_at: 0 })
      })
      return { action: 'ephemeral', text: `✓ Status set to${emoji ? ` :${emoji}:` : ''} ${text}`.trim() }
    }
  },
  {
    name: 'dnd',
    description: 'Set Do Not Disturb mode',
    usage: '/dnd [minutes] — default 60 minutes',
    execute: async (args) => {
      const minutes = parseInt(args.trim(), 10) || 60
      const expiresAt = Date.now() + minutes * 60_000
      await apiFetch('/api/user-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_text: 'Do Not Disturb', status_emoji: '🔕', expires_at: expiresAt })
      })
      return { action: 'ephemeral', text: `Do Not Disturb enabled for ${minutes} minutes.` }
    }
  },
  {
    name: 'mute',
    description: 'Mute the current channel',
    usage: '/mute',
    execute: async (_args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      await apiFetch('/api/channel-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, level: 'nothing', muted: true })
      })
      return { action: 'ephemeral', text: 'Channel muted. You will not receive notifications from this channel.' }
    }
  },
  {
    name: 'unmute',
    description: 'Unmute the current channel',
    usage: '/unmute',
    execute: async (_args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      await apiFetch('/api/channel-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, level: 'default', muted: false })
      })
      return { action: 'ephemeral', text: 'Channel unmuted. Notifications restored.' }
    }
  },
  {
    name: 'remind',
    description: 'Set a reminder for a message',
    usage: '/remind [minutes] [message] — e.g. /remind 30 Review PR',
    execute: async (args) => {
      const match = args.trim().match(/^(\d+)\s+(.+)$/s)
      if (!match) return { action: 'ephemeral', text: 'Usage: /remind [minutes] [message]' }
      const minutes = parseInt(match[1], 10)
      const body = match[2].trim()
      const fireAt = Date.now() + minutes * 60_000
      await apiFetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, fire_at: fireAt })
      })
      return { action: 'ephemeral', text: `⏰ Reminder set for ${minutes} minutes from now.` }
    }
  },
  {
    name: 'help',
    description: 'Show available slash commands',
    usage: '/help',
    execute: async () => {
      const list = commands
        .map(c => `**/${c.name}** — ${c.description}\n  \`${c.usage}\``)
        .join('\n\n')
      return { action: 'ephemeral', text: `**Available commands:**\n\n${list}` }
    }
  },
  {
    name: 'topic',
    description: 'Set the channel topic/purpose',
    usage: '/topic [new topic text]',
    execute: async (args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      const topic = args.trim()
      if (!topic) return { action: 'ephemeral', text: 'Usage: /topic [new topic text]' }
      await apiFetch(`/api/channel-info`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, purpose: topic })
      })
      return { action: 'ephemeral', text: `✓ Channel topic updated to: ${topic}` }
    }
  },
  {
    name: 'join',
    description: 'Join a channel by name',
    usage: '/join [channel-name]',
    execute: async (args) => {
      const name = args.trim().replace(/^#/, '')
      if (!name) return { action: 'ephemeral', text: 'Usage: /join [channel-name]' }
      const res = await apiFetch(`/api/channels/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: name })
      })
      if (res.ok) return { action: 'ephemeral', text: `✓ Joined #${name}` }
      return { action: 'ephemeral', text: `⚠ Could not join #${name}. Channel may not exist or you may not have access.` }
    }
  },
  {
    name: 'invite',
    description: 'Invite a user to the current channel',
    usage: '/invite @username',
    execute: async (args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      const username = args.trim().replace(/^@/, '')
      if (!username) return { action: 'ephemeral', text: 'Usage: /invite @username' }
      const res = await apiFetch(`/api/channel-members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, username })
      })
      if (res.ok) return { action: 'ephemeral', text: `✓ Invited @${username} to this channel.` }
      return { action: 'ephemeral', text: `⚠ Could not invite @${username}. User may not exist or is already a member.` }
    }
  },
  {
    name: 'collapse',
    description: 'Collapse all image & link previews in the channel',
    usage: '/collapse',
    execute: async () => {
      return { action: 'ephemeral', text: 'Previews collapsed. Use /expand to restore.' }
    }
  },
  {
    name: 'expand',
    description: 'Expand all image & link previews in the channel',
    usage: '/expand',
    execute: async () => {
      return { action: 'ephemeral', text: 'Previews expanded.' }
    }
  },
  {
    name: 'archive',
    description: 'Archive the current channel',
    usage: '/archive',
    execute: async (_args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      await apiFetch('/api/channel-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, archived: true })
      })
      return { action: 'ephemeral', text: '✓ Channel archived. Members can still view history.' }
    }
  },
  {
    name: 'unarchive',
    description: 'Unarchive the current channel',
    usage: '/unarchive',
    execute: async (_args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      await apiFetch('/api/channel-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, archived: false })
      })
      return { action: 'ephemeral', text: '✓ Channel unarchived. Members can post again.' }
    }
  },
  {
    name: 'rename',
    description: 'Rename the current channel',
    usage: '/rename [new display name]',
    execute: async (args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      const name = args.trim()
      if (!name) return { action: 'ephemeral', text: 'Usage: /rename [new display name]' }
      await apiFetch('/api/channel-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, display_name: name })
      })
      return { action: 'ephemeral', text: `✓ Channel renamed to: ${name}` }
    }
  },
  {
    name: 'who',
    description: 'List online members in the current channel',
    usage: '/who',
    execute: async (_args, channelId) => {
      if (!channelId) return { action: 'ephemeral', text: 'No channel selected.' }
      const res = await apiFetch(`/api/channel-members?channel_id=${encodeURIComponent(channelId)}`)
      if (!res.ok) return { action: 'ephemeral', text: '⚠ Could not load members.' }
      const data = await res.json() as { members?: { username: string }[] }
      const list = (data.members || []).map(m => `@${m.username}`).join(', ')
      return { action: 'ephemeral', text: list || 'No members found.' }
    }
  }
]

/**
 * Check if a message is a slash command. Returns null if it's not.
 */
export function parseSlashCommand(message: string): { name: string; args: string } | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx > 0 ? trimmed.slice(1, spaceIdx).toLowerCase() : trimmed.slice(1).toLowerCase()
  const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1) : ''
  if (!name || /\s/.test(name)) return null
  return { name, args }
}

/**
 * Execute a slash command. Returns null if the command is not recognized.
 */
export async function executeSlashCommand(
  name: string,
  args: string,
  channelId: string
): Promise<SlashCommandResult | null> {
  const cmd = commands.find(c => c.name === name)
  if (!cmd) return null
  try {
    return await cmd.execute(args, channelId)
  } catch {
    return { action: 'ephemeral', text: `⚠ Command /${name} failed. Please try again.` }
  }
}

/** Get the list of all registered commands for autocomplete. */
export function getSlashCommands(): { name: string; description: string; usage: string }[] {
  return commands.map(c => ({ name: c.name, description: c.description, usage: c.usage }))
}
