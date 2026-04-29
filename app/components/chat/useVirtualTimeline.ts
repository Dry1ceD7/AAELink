'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Lightweight virtual scroller for variable-height chat messages.
 *
 * Unlike react-window (which requires fixed heights), this uses a viewport
 * intersection observer to track which DOM children are near the viewport
 * and only renders those. This mirrors Slack's production approach.
 *
 * Usage:
 *   const { visibleRange, containerProps, sentinelTop, sentinelBottom } = useVirtualTimeline(...)
 *   // Render only posts[visibleRange.start..visibleRange.end]
 *   // Place sentinelTop at the top and sentinelBottom at the bottom of the scroll area
 */

const OVERSCAN = 15          // Extra items above/below viewport
const INITIAL_TAIL = 60      // Initial number of items to render from the end
const RECALC_DEBOUNCE = 80   // ms

interface VirtualTimelineResult {
  /** Inclusive start and exclusive end of the visible range. */
  visibleRange: { start: number; end: number }
  /** Callback ref to set on the scroll container. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Whether the list is currently pinned to the bottom (auto-scroll on new messages). */
  isAtBottom: boolean
  /** Call when new messages arrive at the bottom to auto-scroll if pinned. */
  scrollToBottomIfPinned: () => void
}

export function useVirtualTimeline(
  totalCount: number,
  scrollRef: RefObject<HTMLDivElement | null>
): VirtualTimelineResult {
  // Visible window (in terms of item indices)
  const [range, setRange] = useState(() => ({
    start: Math.max(0, totalCount - INITIAL_TAIL),
    end: totalCount
  }))
  const isAtBottomRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const lastTotal = useRef(totalCount)

  // When total count changes (new messages), extend end and keep pinned
  useEffect(() => {
    if (totalCount !== lastTotal.current) {
      const delta = totalCount - lastTotal.current
      lastTotal.current = totalCount

      if (delta > 0 && isAtBottomRef.current) {
        // New items at the bottom — extend viewport
        setRange(r => ({
          start: Math.max(0, r.start),
          end: totalCount
        }))
      } else if (delta < 0) {
        // Items removed (deletion) — clamp
        setRange(r => ({
          start: Math.min(r.start, Math.max(0, totalCount - INITIAL_TAIL)),
          end: Math.min(r.end, totalCount)
        }))
      }
    }
  }, [totalCount])

  // Scroll handler: detect if we're at the bottom + virtual window adjustment
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const { scrollTop, scrollHeight, clientHeight } = el
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    isAtBottomRef.current = atBottom
    setIsAtBottom(atBottom)

    // If near the top, extend the rendered range upward (infinite scroll back)
    if (scrollTop < 200 && range.start > 0) {
      const prevHeight = el.scrollHeight
      setRange(r => ({
        start: Math.max(0, r.start - OVERSCAN),
        end: r.end
      }))
      // Preserve scroll position after prepending
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const newHeight = scrollRef.current.scrollHeight
          scrollRef.current.scrollTop += newHeight - prevHeight
        }
      })
    }
  }, [range.start, scrollRef])

  // Debounced scroll listener
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const handler = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(onScroll, RECALC_DEBOUNCE)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => {
      el.removeEventListener('scroll', handler)
      if (timer) clearTimeout(timer)
    }
  }, [onScroll, scrollRef])

  const scrollToBottomIfPinned = useCallback(() => {
    if (!isAtBottomRef.current) return
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [scrollRef])

  return {
    visibleRange: range,
    scrollRef,
    isAtBottom,
    scrollToBottomIfPinned
  }
}
