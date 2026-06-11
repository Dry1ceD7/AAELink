/**
 * Sidebar slot ordering — drag-to-reorder default sections (Slack §1.4).
 *
 * AAELink's sidebar renders a fixed set of "conversation slots" (Starred,
 * custom user-defined sections, Channels, Direct Messages). Slack lets users
 * drag these into any order; v0.0.28-alpha brings the same to AAELink.
 *
 * The ordering is per-user and lives in `localStorage` (no server round-trip
 * needed; this is purely a UI preference). Enterprise and Administration
 * sections are NOT included — they are navigation surfaces, not conversation
 * sections, and stay pinned at the bottom.
 */

export type SidebarSlotId = 'starred' | '__custom__' | 'channels' | 'dms'

export const KNOWN_SLOTS: readonly SidebarSlotId[] = [
  'starred',
  '__custom__',
  'channels',
  'dms',
] as const

export const DEFAULT_SIDEBAR_ORDER: readonly SidebarSlotId[] = [
  'starred',
  '__custom__',
  'channels',
  'dms',
] as const

const STORAGE_KEY = 'aaelink-sidebar-order'

/** Type-safe predicate: is `value` a permutation of `KNOWN_SLOTS`? */
export function isValidSidebarOrder(value: unknown): value is readonly SidebarSlotId[] {
  if (!Array.isArray(value)) return false
  if (value.length !== KNOWN_SLOTS.length) return false
  const seen = new Set<string>()
  for (const slot of value) {
    if (typeof slot !== 'string') return false
    if (!KNOWN_SLOTS.includes(slot as SidebarSlotId)) return false
    if (seen.has(slot)) return false
    seen.add(slot)
  }
  return true
}

/**
 * Coerce arbitrary input into a valid sidebar order.
 * - Valid input → returned as-is.
 * - Invalid input → returns DEFAULT_SIDEBAR_ORDER.
 * - Partially-valid input (some slots missing/unknown) → drops unknowns,
 *   appends any missing slots in their default-order positions.
 */
export function normaliseSidebarOrder(value: unknown): readonly SidebarSlotId[] {
  if (isValidSidebarOrder(value)) return value

  if (!Array.isArray(value)) return [...DEFAULT_SIDEBAR_ORDER]

  // Partially valid: keep only known slots, dedupe, then append missing ones
  // in default-order so the user's saved choice is preserved as much as
  // possible across version bumps that introduce new slots.
  const present = new Set<SidebarSlotId>()
  const result: SidebarSlotId[] = []
  for (const slot of value) {
    if (typeof slot !== 'string') continue
    if (!KNOWN_SLOTS.includes(slot as SidebarSlotId)) continue
    if (present.has(slot as SidebarSlotId)) continue
    present.add(slot as SidebarSlotId)
    result.push(slot as SidebarSlotId)
  }
  for (const slot of DEFAULT_SIDEBAR_ORDER) {
    if (!present.has(slot)) result.push(slot)
  }
  return result
}

/**
 * Move the slot at `from` to position `to`, returning a new array.
 * Out-of-range indices are clamped:
 *   - Negative `from` → no-op (returns a copy of the input)
 *   - `to` >= length → moves slot to the end
 */
export function moveSlot(
  order: readonly SidebarSlotId[],
  from: number,
  to: number
): readonly SidebarSlotId[] {
  if (from < 0 || from >= order.length) return [...order]
  const next = [...order]
  const [slot] = next.splice(from, 1)
  const clampedTo = Math.max(0, Math.min(to, next.length))
  next.splice(clampedTo, 0, slot)
  return next
}

export function readSidebarOrder(): readonly SidebarSlotId[] {
  if (typeof window === 'undefined') return [...DEFAULT_SIDEBAR_ORDER]
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_SIDEBAR_ORDER]
    const parsed = JSON.parse(raw)
    return normaliseSidebarOrder(parsed)
  } catch {
    return [...DEFAULT_SIDEBAR_ORDER]
  }
}

export function persistSidebarOrder(order: readonly SidebarSlotId[]): void {
  if (typeof window === 'undefined') return
  if (!isValidSidebarOrder(order)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    /* quota exceeded */
  }
}
