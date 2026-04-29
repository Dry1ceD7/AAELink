/** URL-safe slug for workspace or channel names. */
export function slugifySegment(raw: string, fallback = 'item') {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
  if (s.length >= 2) return s
  return `${fallback}-${Date.now().toString(36)}`.slice(0, 22)
}
