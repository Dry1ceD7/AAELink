import { NextRequest, NextResponse } from 'next/server'

/**
 * Link Preview (URL Unfurling) — GET /api/link-preview?url=...
 *
 * Fetches the target URL and extracts <title>, <meta description>,
 * and og:image for the client-side LinkPreview component.
 *
 * Caches results for 1 hour via Cache-Control header.
 */

const TIMEOUT_MS = 5000
const MAX_HTML_BYTES = 64_000

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url')?.trim()
  if (!rawUrl) return NextResponse.json({ error: 'url_required' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'invalid_protocol' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  // Block private/internal IPs
  const hostname = parsed.hostname
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('172.') ||
    hostname === '0.0.0.0'
  ) {
    return NextResponse.json({ error: 'blocked_host' }, { status: 403 })
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AAELink/1.0 LinkPreview',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow'
    })

    clearTimeout(timer)

    if (!res.ok) return NextResponse.json({ error: 'fetch_failed' }, { status: 502 })

    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return NextResponse.json({ error: 'not_html' }, { status: 422 })
    }

    const body = await res.text()
    const html = body.slice(0, MAX_HTML_BYTES)

    // Extract metadata from HTML
    const title = extractTag(html, /<meta\s+(?:property|name)="og:title"\s+content="([^"]*?)"/i)
      || extractTag(html, /<title[^>]*>([^<]*)<\/title>/i)
      || ''

    const description = extractTag(html, /<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
      || extractTag(html, /<meta\s+name="description"\s+content="([^"]*?)"/i)
      || ''

    const image = extractTag(html, /<meta\s+(?:property|name)="og:image"\s+content="([^"]*?)"/i) || ''

    const domain = parsed.hostname

    const data = {
      title: decodeHtmlEntities(title).slice(0, 300),
      description: decodeHtmlEntities(description).slice(0, 500),
      image: image.startsWith('http') ? image : '',
      domain
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600'
      }
    })
  } catch {
    return NextResponse.json({ error: 'timeout_or_network' }, { status: 504 })
  }
}

function extractTag(html: string, regex: RegExp): string {
  const m = html.match(regex)
  return m?.[1] || ''
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
}
