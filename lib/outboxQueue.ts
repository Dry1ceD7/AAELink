'use client'

/**
 * Offline outbound message queue.
 *
 * When the user sends a message while offline (or the POST fails due to
 * network error), the message is queued in IndexedDB. When connectivity
 * resumes (via the `online` event), all queued messages are flushed in order.
 *
 * This mirrors Slack's "message queued" behavior — the pending ghost stays
 * visible until the network returns and the server confirms.
 */

import { apiFetch } from '@/lib/apiClient'
import { subscribeNetworkOrVisibilityResume } from '@/lib/sseResilience'

const DB_NAME = 'aaelink-outbox'
const DB_VERSION = 1
const STORE = 'pending'

export interface QueuedMessage {
  /** Client-generated UUID for dedup. */
  id: string
  channel_id: string
  message: string
  queued_at: number
}

// ── DB singleton ────────────────────────────────────────────────────────────

let dbP: Promise<IDBDatabase> | null = null

function openOutboxDB(): Promise<IDBDatabase> {
  if (dbP) return dbP
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no idb'))

  dbP = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbP = null; reject(req.error) }
  })
  return dbP
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Enqueue a message that failed to send. */
export async function enqueueMessage(msg: QueuedMessage): Promise<void> {
  try {
    const db = await openOutboxDB()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(msg)
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch { /* best-effort */ }
}

/** Remove a message from the queue (after successful send). */
async function dequeueMessage(id: string): Promise<void> {
  try {
    const db = await openOutboxDB()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch { /* best-effort */ }
}

/** Read all queued messages (oldest first). */
async function readQueue(): Promise<QueuedMessage[]> {
  try {
    const db = await openOutboxDB()
    const tx = db.transaction(STORE, 'readonly')
    return new Promise<QueuedMessage[]>((resolve, reject) => {
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => {
        const all = (req.result as QueuedMessage[]) ?? []
        resolve(all.sort((a, b) => a.queued_at - b.queued_at))
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

/**
 * Flush all queued messages to the server. Returns the IDs of
 * successfully sent messages (caller should reconcile pending posts).
 */
export async function flushOutbox(): Promise<string[]> {
  const queue = await readQueue()
  if (queue.length === 0) return []

  const sent: string[] = []
  for (const msg of queue) {
    try {
      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: msg.channel_id, message: msg.message })
      })
      if (res.ok) {
        await dequeueMessage(msg.id)
        sent.push(msg.id)
      }
      // If server returns 4xx, leave in queue for user to see
    } catch {
      // Network still down — stop trying
      break
    }
  }
  return sent
}

/**
 * Start listening for network recovery and auto-flush.
 * Returns an unsubscribe function.
 *
 * @param onFlushed Called with IDs of messages that were successfully sent
 */
export function startOutboxFlushListener(
  onFlushed?: (ids: string[]) => void
): () => void {
  return subscribeNetworkOrVisibilityResume(async () => {
    const ids = await flushOutbox()
    if (ids.length > 0) onFlushed?.(ids)
  })
}
