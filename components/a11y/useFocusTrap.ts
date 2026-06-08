'use client'

import { useEffect, type RefObject } from 'react'

/**
 * `useFocusTrap` — confines keyboard focus to the elements inside
 * `containerRef` while `active` is true.
 *
 * On activate: focuses the first tabbable element and remembers whatever
 * was focused before (so it can be restored). While active: wraps Tab /
 * Shift+Tab so focus cycles within the container instead of leaking to the
 * page behind a modal. On deactivate (or unmount): restores focus to the
 * previously-focused element.
 *
 * The tabbable set is recomputed on each Tab press so dynamically added or
 * removed controls are handled without a stale snapshot.
 */
const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getTabbable(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)
  )
  return nodes.filter(
    (el) =>
      el.offsetWidth > 0 ||
      el.offsetHeight > 0 ||
      el === document.activeElement
  )
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean
): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const tabbable = getTabbable(container)
    if (tabbable.length > 0) tabbable[0].focus()
    else container.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getTabbable(container)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [containerRef, active])
}
