'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatPost } from '@/lib/realtime/realtime'

/** Tags that indicate the user is actively typing in an input. */
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  if (INPUT_TAGS.has(el.tagName)) return true
  if ((el as HTMLElement).isContentEditable) return true
  // If any modal overlay is open, don't intercept
  if (document.querySelector('.mm-modal-overlay, .pref-modal-overlay, [role="dialog"][aria-modal="true"]')) return true
  return false
}

export interface MessageKeyNavActions {
  onOpenThread: (post: ChatPost) => void
  onEditMessage: (post: ChatPost) => void
  /** Called with the DOM element of the focused message so the parent can open the emoji picker */
  onReactionPicker?: (post: ChatPost, el: HTMLElement) => void
}

export interface MessageKeyNavResult {
  /** The data-message-id of the currently keyboard-focused message, or null */
  focusedMessageId: string | null
  /** Clear the keyboard focus (e.g. when clicking or when the channel changes) */
  clearFocus: () => void
}

/**
 * Slack-style keyboard navigation for the message timeline.
 *
 * Keys (only active when no input is focused):
 *  - `j` / `ArrowDown` — focus next message
 *  - `k` / `ArrowUp`   — focus previous message
 *  - `r`               — open reaction picker on focused message
 *  - `t`               — open thread on focused message
 *  - `e`               — edit the focused message (only if it's yours)
 *  - `Escape`          — clear message focus
 */
export function useMessageKeyNav(
  posts: ChatPost[],
  myId: string | undefined,
  timelineRef: React.RefObject<HTMLDivElement | null>,
  actions: MessageKeyNavActions,
  channelId: string | null
): MessageKeyNavResult {
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const postsRef = useRef(posts)
  postsRef.current = posts

  // Reset focus when channel changes
  useEffect(() => {
    setFocusedIdx(null)
  }, [channelId])

  const clearFocus = useCallback(() => setFocusedIdx(null), [])

  // Scroll the focused message into view & set visual class
  useEffect(() => {
    const container = timelineRef.current
    if (!container) return

    // Remove all existing focus classes
    container.querySelectorAll('.message--kb-focused').forEach(el =>
      el.classList.remove('message--kb-focused')
    )

    if (focusedIdx == null) return
    const post = postsRef.current[focusedIdx]
    if (!post) return

    const el = container.querySelector(`[data-message-id="${CSS.escape(post.id)}"]`) as HTMLElement | null
    if (!el) return

    el.classList.add('message--kb-focused')
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    el.focus({ preventScroll: true })
  }, [focusedIdx, timelineRef])

  // Keyboard handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return

      // e.key can be undefined for synthetic/composition events — guard before toLowerCase.
      const key = (e.key || '').toLowerCase()
      if (!key) return
      const len = postsRef.current.length
      if (len === 0) return

      // Don't hijack modified j/k (Cmd+J, Ctrl+K, Alt+J, …) — those belong to the
      // browser / OS / app command palette, not message navigation.
      if ((key === 'j' || key === 'k') && (e.metaKey || e.ctrlKey || e.altKey)) return

      // J / ArrowDown — next message
      if (key === 'j' || (key === 'arrowdown' && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        setFocusedIdx(prev => {
          if (prev == null) return len - 1 // start from bottom
          return Math.min(prev + 1, len - 1)
        })
        return
      }

      // K / ArrowUp — previous message
      if (key === 'k' || (key === 'arrowup' && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        setFocusedIdx(prev => {
          if (prev == null) return len - 1
          return Math.max(prev - 1, 0)
        })
        return
      }

      // Escape — clear focus
      if (key === 'escape') {
        setFocusedIdx(prev => {
          if (prev != null) {
            e.preventDefault()
            e.stopPropagation()
            return null
          }
          return prev
        })
        return
      }

      // The remaining keys only work when a message is focused
      if (focusedIdx == null) return

      const post = postsRef.current[focusedIdx]
      if (!post) return

      // T — open thread
      if (key === 't') {
        e.preventDefault()
        actions.onOpenThread(post)
        return
      }

      // E — edit (own messages only)
      if (key === 'e') {
        if (myId && post.user_id === myId) {
          e.preventDefault()
          actions.onEditMessage(post)
        }
        return
      }

      // R — react (open reaction picker)
      if (key === 'r') {
        e.preventDefault()
        const container = timelineRef.current
        if (container) {
          const el = container.querySelector(`[data-message-id="${CSS.escape(post.id)}"]`) as HTMLElement | null
          if (el) {
            // Click the emoji/smile button in the message actions toolbar
            const emojiBtn = el.querySelector('button[aria-label*="React"], button[aria-label*="emoji"], .message-actions button:first-child') as HTMLButtonElement | null
            if (emojiBtn) {
              emojiBtn.click()
            } else {
              // Fallback: dispatch a mouseenter to show the toolbar, then try again
              el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
              requestAnimationFrame(() => {
                const btn = el.querySelector('button[aria-label*="React"], button[aria-label*="emoji"], .message-actions button:first-child') as HTMLButtonElement | null
                btn?.click()
              })
            }
          }
        }
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedIdx, myId, actions, timelineRef])

  // Keep focusedIdx inside bounds when posts change
  useEffect(() => {
    if (focusedIdx != null && focusedIdx >= posts.length) {
      setFocusedIdx(posts.length > 0 ? posts.length - 1 : null)
    }
  }, [posts.length, focusedIdx])

  return {
    focusedMessageId: focusedIdx != null ? (posts[focusedIdx]?.id ?? null) : null,
    clearFocus
  }
}
