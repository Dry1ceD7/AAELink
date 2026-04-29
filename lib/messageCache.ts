'use client'

/**
 * IndexedDB local cache for chat messages.
 *
 * Purpose: Load instantly from disk when the app opens, then hydrate from
 * the server in the background (Slack-class "instant load" pattern).
 *
 * Schema:
 *   store "messages" — { id: string, channel_id: string, ... }
 *   index "by-channel" on channel_id + create_at (compound)
 *   store "meta" — per-channel watermarks (last_fetched_at, etc.)
 */

const DB_NAME = 'aaelink-msg-cache'
const DB_VERSION = 1
const MSG_STORE = 'messages'
const META_STORE = 'meta'

export interface CachedPost {
  id: string
  channel_id: string
  user_id: string
  message: string
  create_at: number
  root_id?: string
  reply_count?: number
  edited_at?: number
}

interface ChannelMeta {
  channel_id: string
  last_fetched_at: number
  post_count: number
}

// ── DB singleton ─────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available'))
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result

      if (!db.objectStoreNames.contains(MSG_STORE)) {
        const store = db.createObjectStore(MSG_STORE, { keyPath: 'id' })
        store.createIndex('by-channel', ['channel_id', 'create_at'], { unique: false })
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'channel_id' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })

  return dbPromise
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Save posts to cache (upsert). */
export async function cachePosts(posts: CachedPost[]): Promise<void> {
  if (posts.length === 0) return
  try {
    const db = await openDB()
    const tx = db.transaction(MSG_STORE, 'readwrite')
    const store = tx.objectStore(MSG_STORE)
    for (const p of posts) {
      store.put({
        id: p.id,
        channel_id: p.channel_id,
        user_id: p.user_id,
        message: p.message,
        create_at: p.create_at,
        root_id: p.root_id ?? undefined,
        reply_count: p.reply_count ?? 0,
        edited_at: p.edited_at ?? undefined
      })
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* cache is best-effort */
  }
}

/** Read cached posts for a channel (newest last, limited). */
export async function readCachedPosts(
  channelId: string,
  limit = 60
): Promise<CachedPost[]> {
  try {
    const db = await openDB()
    const tx = db.transaction(MSG_STORE, 'readonly')
    const index = tx.objectStore(MSG_STORE).index('by-channel')

    // Range: [channelId, 0] → [channelId, Infinity]
    const range = IDBKeyRange.bound([channelId, 0], [channelId, Number.MAX_SAFE_INTEGER])

    return new Promise<CachedPost[]>((resolve, reject) => {
      const results: CachedPost[] = []
      // Open cursor in reverse to get newest first
      const req = index.openCursor(range, 'prev')

      req.onsuccess = () => {
        const cursor = req.result
        if (cursor && results.length < limit) {
          results.push(cursor.value as CachedPost)
          cursor.continue()
        } else {
          // Reverse to get oldest→newest order
          resolve(results.reverse())
        }
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

/** Remove deleted posts from cache. */
export async function removeCachedPosts(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    const db = await openDB()
    const tx = db.transaction(MSG_STORE, 'readwrite')
    const store = tx.objectStore(MSG_STORE)
    for (const id of ids) store.delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* best-effort */
  }
}

/** Save per-channel watermark. */
export async function setChannelMeta(channelId: string, lastFetchedAt: number, postCount: number): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put({
      channel_id: channelId,
      last_fetched_at: lastFetchedAt,
      post_count: postCount
    } satisfies ChannelMeta)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* best-effort */
  }
}

/** Read per-channel watermark. */
export async function getChannelMeta(channelId: string): Promise<ChannelMeta | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(META_STORE, 'readonly')
    return new Promise<ChannelMeta | null>((resolve, reject) => {
      const req = tx.objectStore(META_STORE).get(channelId)
      req.onsuccess = () => resolve((req.result as ChannelMeta) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** Prune old messages beyond a per-channel cap. */
export async function pruneChannel(channelId: string, keepCount = 200): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(MSG_STORE, 'readwrite')
    const index = tx.objectStore(MSG_STORE).index('by-channel')
    const range = IDBKeyRange.bound([channelId, 0], [channelId, Number.MAX_SAFE_INTEGER])

    // Count total
    const countReq = index.count(range)
    const total = await new Promise<number>((res, rej) => {
      countReq.onsuccess = () => res(countReq.result)
      countReq.onerror = () => rej(countReq.error)
    })

    if (total <= keepCount) return

    const deleteCount = total - keepCount
    let deleted = 0

    const cursorReq = index.openCursor(range, 'next')
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor && deleted < deleteCount) {
          cursor.delete()
          deleted++
          cursor.continue()
        } else {
          resolve()
        }
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  } catch {
    /* best-effort */
  }
}
