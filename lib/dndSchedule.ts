/**
 * dndSchedule — Do Not Disturb schedule management.
 *
 * Stores a recurring DND window (start/end time) in localStorage.
 * The app checks `isDndActive()` to suppress notification sounds
 * and desktop notifications during the scheduled DND window.
 *
 * Inspired by Slack's "Pause notifications" schedule.
 */
'use client'

export interface DndSchedule {
  enabled: boolean
  startHour: number  // 0-23
  startMinute: number // 0-59
  endHour: number    // 0-23
  endMinute: number  // 0-59
}

const STORAGE_KEY = 'aaelink_dnd_schedule'

const DEFAULT_SCHEDULE: DndSchedule = {
  enabled: false,
  startHour: 22,
  startMinute: 0,
  endHour: 8,
  endMinute: 0,
}

export function getDndSchedule(): DndSchedule {
  if (typeof window === 'undefined') return DEFAULT_SCHEDULE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SCHEDULE
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SCHEDULE
  }
}

export function setDndSchedule(schedule: DndSchedule): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule))
}

/**
 * Check if DND is currently active based on the saved schedule.
 * Handles overnight windows (e.g., 22:00 → 08:00).
 */
export function isDndActive(): boolean {
  const sched = getDndSchedule()
  if (!sched.enabled) return false

  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = sched.startHour * 60 + sched.startMinute
  const endMinutes = sched.endHour * 60 + sched.endMinute

  if (startMinutes <= endMinutes) {
    // Same-day window (e.g., 09:00 → 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  } else {
    // Overnight window (e.g., 22:00 → 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
}

/** Format schedule for display, e.g., "10:00 PM – 8:00 AM" */
export function formatSchedule(sched: DndSchedule): string {
  const fmt = (h: number, m: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }
  return `${fmt(sched.startHour, sched.startMinute)} – ${fmt(sched.endHour, sched.endMinute)}`
}
