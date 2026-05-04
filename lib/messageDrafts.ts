/**
 * Channel-scoped message drafts persisted in localStorage.
 *
 * Draft text is auto-saved per channel_id (or thread root_id) so the user
 * never loses in-progress messages when switching channels, exactly like Slack.
 *
 * Storage key: `aaelink-drafts`
 * Shape: Record<channelOrThreadId, { text: string; updatedAt: number }>
 *
 * Drafts older than 30 days are automatically purged on read.
 */

const STORAGE_KEY = 'aaelink-drafts'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface DraftEntry {
  text: string
  updatedAt: number
}

type DraftStore = Record<string, DraftEntry>

function readAll(): DraftStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const store = JSON.parse(raw) as DraftStore

    // Purge stale entries
    const now = Date.now()
    let dirty = false
    for (const key of Object.keys(store)) {
      if (now - store[key].updatedAt > MAX_AGE_MS) {
        delete store[key]
        dirty = true
      }
    }
    if (dirty) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    }

    return store
  } catch {
    return {}
  }
}

function writeAll(store: DraftStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage full — noop
  }
}

/**
 * Get the saved draft text for a channel or thread.
 * Returns empty string if no draft exists.
 */
export function getDraft(channelOrThreadId: string): string {
  if (!channelOrThreadId) return ''
  const store = readAll()
  return store[channelOrThreadId]?.text || ''
}

/**
 * Save a draft for a channel or thread.
 * If text is empty, removes the draft entry.
 */
export function saveDraft(channelOrThreadId: string, text: string): void {
  if (!channelOrThreadId) return
  const store = readAll()

  const trimmed = text.trim()
  if (!trimmed) {
    delete store[channelOrThreadId]
  } else {
    store[channelOrThreadId] = { text, updatedAt: Date.now() }
  }

  writeAll(store)
}

/**
 * Clear the draft for a channel or thread (e.g. after sending).
 */
export function clearDraft(channelOrThreadId: string): void {
  if (!channelOrThreadId) return
  const store = readAll()
  delete store[channelOrThreadId]
  writeAll(store)
}

/**
 * Get all channel IDs that have drafts (for sidebar indicators).
 */
export function getChannelIdsWithDrafts(): string[] {
  const store = readAll()
  return Object.keys(store).filter(k => (store[k]?.text || '').trim().length > 0)
}

/**
 * Count total active drafts.
 */
export function getDraftCount(): number {
  return getChannelIdsWithDrafts().length
}
