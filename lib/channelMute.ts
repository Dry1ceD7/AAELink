/**
 * Client-side channel mute persistence.
 * Muted channels suppress desktop notifications and bold-unread styling.
 */

const KEY = 'aaelink-muted-channels'

export function readMutedChannels(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch { return new Set() }
}

export function toggleMuteChannel(channelId: string): boolean {
  const muted = readMutedChannels()
  const wasMuted = muted.has(channelId)
  if (wasMuted) {
    muted.delete(channelId)
  } else {
    muted.add(channelId)
  }
  localStorage.setItem(KEY, JSON.stringify([...muted]))
  return !wasMuted
}

export function isChannelMuted(channelId: string): boolean {
  return readMutedChannels().has(channelId)
}
