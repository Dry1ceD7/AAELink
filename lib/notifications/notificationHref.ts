import type { ApiNotification } from '@/lib/notifications/notificationTypes'

/** In-app path for a notification (same origin). */
export function hrefForNotification(n: ApiNotification): string {
  if (n.kind === 'support_emergency') {
    return '/admin'
  }
  const team = encodeURIComponent(n.workspace_id)
  if (n.message_id) {
    const mid = encodeURIComponent(n.message_id)
    return `/home?team=${team}&focus_msg=${mid}`
  }
  if (n.channel_id) {
    const ch = encodeURIComponent(n.channel_id)
    return `/home?team=${team}&channel=${ch}`
  }
  if (n.ticket_id) {
    const t = encodeURIComponent(n.ticket_id)
    return `/home?team=${team}&module=tickets&ticket=${t}`
  }
  return `/home?team=${team}`
}
