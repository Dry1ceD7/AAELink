'use client'

/**
 * AAE — Date separator + jump-to-date helpers (Blueprint Part 3.2 Phase A).
 *
 * `DateSeparator` is a pure presentational row to drop between messages
 * inside the existing virtual timeline. `groupMessagesByDay` turns a flat
 * sorted message list into [{ key, label, items }] groups so callers can
 * render separators without changing virtualization logic.
 *
 * Why standalone instead of editing home/page.tsx (1.5 kLOC):
 * - Keeps the change surgical and reviewable.
 * - Reuses the existing `useVirtualTimeline` hook unchanged.
 * - The same helpers can be reused in ThreadPanel and SearchPanel later.
 */

import { useMemo, type ReactNode } from 'react'

/**
 * Render-friendly day grouping. Sticks the date row above each group so
 * Slack-style "Today / Yesterday / Mar 5" labels appear in the timeline.
 */
export interface DayGroup<T> {
  /** Stable key (yyyy-mm-dd in viewer's tz). */
  key: string
  /** Human label: "Today" / "Yesterday" / e.g. "Tuesday, March 5". */
  label: string
  /** Whether this group is the most recent ("Today" if any). */
  isToday: boolean
  /** Items belonging to this day, preserving the input order. */
  items: T[]
}

const ONE_DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Format a day-start timestamp for display.
 * - Same calendar day → "Today"
 * - One calendar day before → "Yesterday"
 * - Same week → weekday name ("Monday")
 * - Otherwise → "Mar 5, 2026"
 */
function formatDayLabel(dayStartMs: number, now: Date = new Date()): string {
  const today = startOfDay(now)
  const diffDays = Math.round((today - dayStartMs) / ONE_DAY_MS)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const d = new Date(dayStartMs)
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

/**
 * Group messages by local day. Stable. Pure. Exposes useful keys for
 * jump-to-date.
 *
 * @param items   Sorted ascending by created_at (the existing timeline
 *                already does this).
 * @param getTs   Returns ms-epoch from each item.
 */
export function useGroupByDay<T>(
  items: readonly T[],
  getTs: (item: T) => number,
  now?: Date
): DayGroup<T>[] {
  return useMemo(() => {
    const groups: DayGroup<T>[] = []
    const todayKey = dayKey(now ?? new Date())
    let current: DayGroup<T> | null = null
    for (const item of items) {
      const ts = getTs(item)
      if (!Number.isFinite(ts)) continue
      const date = new Date(ts)
      const k = dayKey(date)
      if (!current || current.key !== k) {
        current = {
          key: k,
          label: formatDayLabel(startOfDay(date), now),
          isToday: k === todayKey,
          items: [],
        }
        groups.push(current)
      }
      current.items.push(item)
    }
    return groups
  }, [items, getTs, now])
}

/**
 * Sticky date row to render between messages.
 * Visually inert by default — only the inner pill is interactive when
 * `onClick` is supplied (jump-to-date trigger).
 */
export function DateSeparator({
  label,
  onClick,
}: {
  label: ReactNode
  onClick?: () => void
}) {
  return (
    <div className="aae-date-sep" role="separator" aria-label={typeof label === 'string' ? label : undefined}>
      {onClick ? (
        <button
          type="button"
          className="aae-date-sep__pill"
          onClick={onClick}
          style={{ pointerEvents: 'auto', cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit', font: 'inherit' }}
        >
          {label}
        </button>
      ) : (
        <span className="aae-date-sep__pill">{label}</span>
      )}
    </div>
  )
}

/**
 * Floating pill anchored to the top of a scroll container.
 * Shows the user the current day they're reading and lets them jump to
 * an arbitrary date via a native `<input type="date">`.
 */
export function JumpToDate({
  currentLabel,
  hidden = false,
  onPickDate,
}: {
  currentLabel: string
  hidden?: boolean
  onPickDate?: (yyyyMmDd: string) => void
}) {
  return (
    <label
      className="aae-jump-to-date"
      hidden={hidden}
      aria-label="Jump to date"
      title="Jump to date"
    >
      <svg
        className="aae-jump-to-date__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2"  x2="16" y2="6" />
        <line x1="8"  y1="2"  x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
      <span>{currentLabel}</span>
      {onPickDate && (
        <input
          type="date"
          aria-label="Pick a date to jump to"
          onChange={(e) => {
            const v = e.currentTarget.value
            if (v) onPickDate(v)
          }}
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            cursor: 'pointer',
            width: '100%',
            height: '100%',
          }}
        />
      )}
    </label>
  )
}
