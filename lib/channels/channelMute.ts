/**
 * Channel mute management — hybrid server + localStorage.
 * Server-side persistence via /api/channels/mute.
 * Falls back to localStorage when offline or during SSR.
 */

import { apiFetch } from '@/lib/api/apiClient'

const KEY = 'aaelink-muted-channels'

/** Read muted channel IDs from localStorage (fast, synchronous). */
export function readMutedChannels(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

/** Synchronize muted channels from the server into localStorage. */
export async function syncMutedChannels(workspaceId: string): Promise<Set<string>> {
  try {
    const res = await apiFetch(`/api/channels/mute?workspace_id=${encodeURIComponent(workspaceId)}`)
    if (res.ok) {
      const data = await res.json() as { muted: string[] }
      const set = new Set(data.muted || [])
      if (typeof window !== 'undefined') {
        localStorage.setItem(KEY, JSON.stringify([...set]))
      }
      return set
    }
  } catch { /* fallback to localStorage */ }
  return readMutedChannels()
}

/** Toggle mute state for a channel. Persists to server and localStorage. */
export async function toggleMuteChannel(channelId: string): Promise<boolean> {
  const muted = readMutedChannels()
  const wasMuted = muted.has(channelId)
  const nowMuted = !wasMuted

  // Optimistic local update
  if (nowMuted) muted.add(channelId)
  else muted.delete(channelId)
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY, JSON.stringify([...muted]))
  }

  // Persist to server
  try {
    await apiFetch('/api/channels/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, muted: nowMuted })
    })
  } catch { /* silent — local state is already updated */ }

  return nowMuted
}

export function isChannelMuted(channelId: string): boolean {
  return readMutedChannels().has(channelId)
}
