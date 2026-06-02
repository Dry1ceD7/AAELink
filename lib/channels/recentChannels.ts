'use client'

const KEY = 'aaelink_recent_channel_ids_v1'
const MAX = 40

export function touchRecentChannel(channelId: string): void {
  if (typeof window === 'undefined' || !channelId.trim()) return
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    const arr = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const next = [channelId, ...arr.filter(x => x !== channelId)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function readRecentChannelIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
  } catch {
    return []
  }
}
