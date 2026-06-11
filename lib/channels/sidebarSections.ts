/**
 * Sidebar custom sections — Slack-style channel grouping.
 *
 * A "custom section" is a user-defined named bucket that contains channels
 * the user has assigned to it. The default sections (Starred / Channels /
 * Direct messages / Enterprise / Administration) are always rendered;
 * custom sections appear between Starred and Channels.
 *
 * Persistence: the assignment-from-channel-to-section is stored server-side
 * via `/api/channel-categories`. The list of section names is derived from
 * the distinct `category` values of the user's assignments.
 *
 * The `category` value `'_starred'` / `'_channels'` / `'_dm'` are reserved
 * for the built-in sections and ignored here.
 */

import { apiFetch } from '@/lib/api/apiClient'

export interface ChannelCategoryRow {
  channel_id: string
  category: string
  sort_order: number
}

export const RESERVED_CATEGORIES = new Set(['_starred', '_channels', '_dm', 'favorites', 'channels', 'direct_messages'])

/** Trim, lowercase, slug-ify a section name to a stable category key. */
export function sectionKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || ''
}

/** Display label for a stored category key. */
export function sectionLabel(key: string): string {
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export async function loadChannelCategories(): Promise<ChannelCategoryRow[]> {
  try {
    const res = await apiFetch('/api/channel-categories')
    if (!res.ok) return []
    const data = (await res.json()) as { categories?: ChannelCategoryRow[] }
    return Array.isArray(data.categories) ? data.categories : []
  } catch {
    return []
  }
}

export async function moveChannelToSection(channelId: string, category: string, sortOrder = 0): Promise<boolean> {
  const key = sectionKey(category)
  if (!key) return false
  if (RESERVED_CATEGORIES.has(key)) return false
  const res = await apiFetch('/api/channel-categories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: channelId, category: key, sort_order: sortOrder }),
  })
  return res.ok
}

export async function removeChannelFromSection(channelId: string): Promise<boolean> {
  const res = await apiFetch('/api/channel-categories', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: channelId }),
  })
  return res.ok
}

/**
 * Group a list of channels by their custom section.
 * Channels not in any custom section land in the `null` bucket (caller renders them in default Channels).
 */
export function groupChannelsBySection<T extends { id: string }>(
  channels: T[],
  assignments: Map<string, string>,
): { sections: Map<string, T[]>; ungrouped: T[] } {
  const sections = new Map<string, T[]>()
  const ungrouped: T[] = []
  for (const ch of channels) {
    const cat = assignments.get(ch.id)
    if (cat && !RESERVED_CATEGORIES.has(cat)) {
      const list = sections.get(cat) ?? []
      list.push(ch)
      sections.set(cat, list)
    } else {
      ungrouped.push(ch)
    }
  }
  return { sections, ungrouped }
}


/* ─────────────────────────────────────────────────────────────────────
   Manage-my-sidebar preferences (Slack §1.4)
   Persisted in localStorage so they survive reloads.
   ───────────────────────────────────────────────────────────────────── */

const MANAGE_KEY = 'aaelink-sidebar-manage'

export interface ManageSidebarPrefs {
  /**
   * Filter mode for the channel list:
   *   'all'     — show every channel (default)
   *   'unread'  — show channels with unread messages or mentions only
   *   'active'  — channels active within the last 30 days (matches Slack)
   */
  filterMode: 'all' | 'unread' | 'active'
  /** Hide muted channels and DMs entirely. */
  hideMuted: boolean
  /** Sort channels A→Z (true) or by recency (false, default). */
  sortAlpha: boolean
  /** Show profile pictures next to DM names instead of presence dots. */
  showProfilePictures: boolean
}

const MANAGE_DEFAULTS: ManageSidebarPrefs = {
  filterMode: 'all',
  hideMuted: false,
  sortAlpha: false,
  showProfilePictures: false,
}

export function readManageSidebarPrefs(): ManageSidebarPrefs {
  if (typeof window === 'undefined') return { ...MANAGE_DEFAULTS }
  try {
    const raw = localStorage.getItem(MANAGE_KEY)
    if (!raw) return { ...MANAGE_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<ManageSidebarPrefs>
    return {
      filterMode: parsed.filterMode === 'unread' || parsed.filterMode === 'active' ? parsed.filterMode : 'all',
      hideMuted: Boolean(parsed.hideMuted),
      sortAlpha: Boolean(parsed.sortAlpha),
      showProfilePictures: Boolean(parsed.showProfilePictures),
    }
  } catch {
    return { ...MANAGE_DEFAULTS }
  }
}

export function persistManageSidebarPrefs(prefs: ManageSidebarPrefs): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MANAGE_KEY, JSON.stringify(prefs))
  } catch { /* quota exceeded */ }
}
