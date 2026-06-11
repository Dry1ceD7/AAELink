/**
 * AAELink — Do-Not-Disturb active-window check (pure, timezone-aware).
 *
 * Shared by push targeting (lib/notifications/pushTargeting.ts) so a user's
 * configured DND schedule suppresses auto-push the same way the /api/dnd route
 * reports `is_active`. Unlike the route's older local-time helper, this honours
 * the stored IANA timezone via Intl.
 */

/** Minutes-since-midnight for `at`, evaluated in the given IANA timezone. */
function minutesInZone(at: Date, timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
    const parts = fmt.formatToParts(at)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
    return h * 60 + m
  } catch {
    return at.getHours() * 60 + at.getMinutes()
  }
}

/**
 * True if `at` falls within the daily [start, end) DND window (HH:MM strings).
 * Handles overnight ranges (e.g. 22:00–08:00). Equal start/end ⇒ never active.
 */
export function isDndActiveNow(
  startTime: string,
  endTime: string,
  timezone = 'UTC',
  at: Date = new Date(),
): boolean {
  try {
    const nowMinutes = minutesInZone(at, timezone)
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return false
    const startMin = sh * 60 + sm
    const endMin = eh * 60 + em
    if (startMin === endMin) return false
    if (startMin < endMin) {
      // Same-day range: e.g. 09:00 – 17:00
      return nowMinutes >= startMin && nowMinutes < endMin
    }
    // Overnight range: e.g. 22:00 – 08:00
    return nowMinutes >= startMin || nowMinutes < endMin
  } catch {
    return false
  }
}
