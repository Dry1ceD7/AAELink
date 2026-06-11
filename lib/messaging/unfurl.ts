/**
 * URL unfurling — fetch metadata and generate rich preview blocks.
 *
 * Supports Open Graph / Twitter Card tags, favicon extraction,
 * and internal link resolution (message permalink, channel, user).
 */

export interface UnfurlMetadata {
  url: string
  title: string
  description: string
  image: string
  favicon: string
  site_name: string
}

export interface UnfurlBlock {
  type: 'rich_preview'
  url: string
  title: string
  description: string
  image_url: string
  favicon_url: string
  site_name: string
}

const FETCH_TIMEOUT_MS = 5000

function sanitize(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

function extractMeta(html: string, property: string): string {
  // Try og:property, then twitter:property, then name=property
  const patterns = [
    new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']twitter:${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:${property}["']`, 'i'),
  ]
  for (const pat of patterns) {
    const m = html.match(pat)
    if (m?.[1]) return sanitize(m[1])
  }
  return ''
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m?.[1] ? sanitize(m[1]) : ''
}

function extractFavicon(html: string, baseUrl: string): string {
  const m = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i)
  if (m?.[1]) {
    try { return new URL(m[1], baseUrl).href } catch { return '' }
  }
  try { return new URL('/favicon.ico', baseUrl).href } catch { return '' }
}

export async function unfurlUrl(url: string): Promise<UnfurlMetadata> {
  const empty: UnfurlMetadata = { url, title: '', description: '', image: '', favicon: '', site_name: '' }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AAELinkBot/1.0', Accept: 'text/html' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return empty
    const html = await res.text()
    return {
      url,
      title: extractMeta(html, 'title') || extractTitle(html),
      description: extractMeta(html, 'description'),
      image: extractMeta(html, 'image'),
      favicon: extractFavicon(html, url),
      site_name: extractMeta(html, 'site_name'),
    }
  } catch {
    return empty
  }
}

/** Resolve internal AAELink links — message permalink, channel, user */
export function unfurlInternalLink(url: string): { type: string; id: string } | null {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] === 'messages' && parts[1]) return { type: 'message', id: parts[1] }
    if (parts[0] === 'channels' && parts[1]) return { type: 'channel', id: parts[1] }
    if (parts[0] === 'users' && parts[1])    return { type: 'user',    id: parts[1] }
    return null
  } catch {
    return null
  }
}

export function generateUnfurlBlocks(metadata: UnfurlMetadata): UnfurlBlock[] {
  if (!metadata.title && !metadata.description) return []
  return [{
    type: 'rich_preview',
    url: metadata.url,
    title: metadata.title,
    description: metadata.description,
    image_url: metadata.image,
    favicon_url: metadata.favicon,
    site_name: metadata.site_name,
  }]
}
