'use client'

import { LogIn, LogOut, Hash, Pin, Settings, Archive, Users } from 'lucide-react'
import type { ChatPost } from '@/lib/realtime/realtime'
import type { AppUser } from './ChatMessage'
import { displayName } from './ChatMessage'
import { formatUserTime } from '@/lib/ui/userPreferences'

/** System message type strings — mirrors the `type` column in aaelink.messages. */
const SYSTEM_TYPES = new Set([
  'system_join',
  'system_leave',
  'system_topic',
  'system_purpose',
  'system_header',
  'system_pin',
  'system_channel_converted',
  'system_archive',
])

export function isSystemPost(post: ChatPost): boolean {
  return Boolean(post.type && SYSTEM_TYPES.has(post.type))
}

interface SystemMessageProps {
  post: ChatPost
  userMap: Record<string, AppUser>
}

function getIcon(type: string) {
  switch (type) {
    case 'system_join': return <LogIn size={14} aria-hidden="true" />
    case 'system_leave': return <LogOut size={14} aria-hidden="true" />
    case 'system_topic':
    case 'system_purpose':
    case 'system_header': return <Settings size={14} aria-hidden="true" />
    case 'system_pin': return <Pin size={14} aria-hidden="true" />
    case 'system_channel_converted': return <Users size={14} aria-hidden="true" />
    case 'system_archive': return <Archive size={14} aria-hidden="true" />
    default: return <Hash size={14} aria-hidden="true" />
  }
}

function formatBody(post: ChatPost, userMap: Record<string, AppUser>): string {
  const u = userMap[post.user_id]
  const name = u ? displayName(u) : 'Someone'

  switch (post.type) {
    case 'system_join':
      return `${name} joined the channel`
    case 'system_leave':
      return `${name} left the channel`
    case 'system_topic':
      return post.message
        ? `${name} set the channel topic: ${post.message}`
        : `${name} cleared the channel topic`
    case 'system_purpose':
      return post.message
        ? `${name} set the channel description: ${post.message}`
        : `${name} cleared the channel description`
    case 'system_header':
      return post.message
        ? `${name} updated the channel header: ${post.message}`
        : `${name} cleared the channel header`
    case 'system_pin':
      return `${name} pinned a message to this channel`
    case 'system_channel_converted':
      return `${name} converted this channel to ${post.message || 'private'}`
    case 'system_archive':
      return `${name} archived this channel`
    default:
      return post.message || 'System event'
  }
}

export function SystemMessage({ post, userMap }: SystemMessageProps) {
  const time = formatUserTime(new Date(post.create_at))
  const fullDate = new Date(post.create_at).toLocaleString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div
      className="system-message"
      role="status"
      aria-label={formatBody(post, userMap)}
      data-message-id={post.id}
    >
      <span className="system-message-icon">{getIcon(post.type || '')}</span>
      <span className="system-message-body">{formatBody(post, userMap)}</span>
      <span className="system-message-time" title={fullDate}>{time}</span>
    </div>
  )
}
