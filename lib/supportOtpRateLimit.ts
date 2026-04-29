const windowMs = 15 * 60 * 1000
const maxPerWindow = 5

type Entry = { count: number; resetAt: number }
const byUser = new Map<string, Entry>()

export function supportOtpRateLimitHit(userId: string): boolean {
  const now = Date.now()
  let e = byUser.get(userId)
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + windowMs }
    byUser.set(userId, e)
  }
  e.count += 1
  return e.count > maxPerWindow
}
