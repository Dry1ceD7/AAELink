/**
 * Client-side channel-star persistence via localStorage.
 * No backend needed — stars are user-local preferences.
 */

const KEY = 'aaelink-starred-channels'

export function readStarredChannels(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(arr)
  } catch { return new Set() }
}

export function toggleStarChannel(channelId: string): boolean {
  const stars = readStarredChannels()
  const wasStarred = stars.has(channelId)
  if (wasStarred) {
    stars.delete(channelId)
  } else {
    stars.add(channelId)
  }
  localStorage.setItem(KEY, JSON.stringify([...stars]))
  return !wasStarred
}

export function isChannelStarred(channelId: string): boolean {
  return readStarredChannels().has(channelId)
}
