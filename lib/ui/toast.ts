// Tiny dependency-free pub/sub toast bus.
//
// Lives outside React so that non-component code (e.g. catch blocks in async
// handlers, plain utility modules) can call `toast.error(...)` without needing
// a React context. `ToastProvider` subscribes to this bus and renders the UI.

export type ToastVariant = 'error' | 'success' | 'info'

export interface ToastItem {
  id: number
  variant: ToastVariant
  message: string
}

type Listener = (item: ToastItem) => void

const listeners: Listener[] = []

// Monotonic integer counter — deterministic ids, never a clock/random source.
let nextId = 0

function emit(variant: ToastVariant, message: string): void {
  const item: ToastItem = { id: nextId++, variant, message }
  for (const listener of listeners) listener(item)
}

/**
 * Subscribe to toast emissions. Returns an unsubscribe function.
 */
export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const i = listeners.indexOf(listener)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export const toast = {
  error(message: string): void { emit('error', message) },
  success(message: string): void { emit('success', message) },
  info(message: string): void { emit('info', message) },
}
