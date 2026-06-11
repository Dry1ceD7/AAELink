'use client'

import { useEffect, useRef } from 'react'

/**
 * useMenuNav — keyboard navigation primitive for `role="menu"` portals.
 *
 * Wires Up/Down arrows to cycle through `[role="menuitem"]` children of the
 * supplied container, Home/End to jump to first/last, and Escape to close.
 * The first menuitem receives focus on mount.
 *
 * Usage:
 *   const ref = useMenuNav<HTMLDivElement>(open, () => setOpen(false))
 *   <div ref={ref} role="menu">...</div>
 *
 * Renders no DOM. Caller still controls open/close state and rendering.
 */
export function useMenuNav<E extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<E | null>(null)

  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return
    const items = () => Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
      el => !el.hasAttribute('disabled') && el.offsetParent !== null
    )

    // Focus the first item on mount.
    const t = window.setTimeout(() => items()[0]?.focus(), 0)

    const onKey = (e: KeyboardEvent) => {
      if (!root.contains(document.activeElement)) return
      const all = items()
      const idx = all.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = all[(idx + 1) % Math.max(1, all.length)]
        next?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = all[(idx - 1 + all.length) % Math.max(1, all.length)]
        next?.focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        all[0]?.focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        all[all.length - 1]?.focus()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return ref
}
