/**
 * Channel star management — hybrid server + localStorage.
 * Server-side persistence via /api/channels/stars.
 * Falls back to localStorage when offline or during SSR.
 */

import { apiFetch } from '@/lib/api/apiClient'

const KEY = 'aaelink-starred-channels'

/** Read starred channel IDs from localStorage (fast, synchronous). */
export function readStarredChannels(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(arr)
  } catch { return new Set() }
}

/** Synchronize starred channels from the server into localStorage. */
export async function syncStarredChannels(workspaceId: string): Promise<Set<string>> {
  try {
    const res = await apiFetch(`/api/channels/stars?workspace_id=${encodeURIComponent(workspaceId)}`)
    if (res.ok) {
      const data = await res.json() as { starred: string[] }
      const set = new Set(data.starred || [])
      if (typeof window !== 'undefined') {
        localStorage.setItem(KEY, JSON.stringify([...set]))
      }
      return set
    }
  } catch { /* fallback to localStorage */ }
  return readStarredChannels()
}

/** Toggle star state for a channel. Persists to server and localStorage. */
export async function toggleStarChannel(channelId: string): Promise<boolean> {
  const stars = readStarredChannels()
  const wasStarred = stars.has(channelId)
  const nowStarred = !wasStarred

  // Optimistic local update
  if (nowStarred) stars.add(channelId)
  else stars.delete(channelId)
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY, JSON.stringify([...stars]))
  }

  // Persist to server
  try {
    await apiFetch('/api/channels/stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, starred: nowStarred })
    })
  } catch { /* silent — local state is already updated */ }

  return nowStarred
}

export function isChannelStarred(channelId: string): boolean {
  return readStarredChannels().has(channelId)
}
