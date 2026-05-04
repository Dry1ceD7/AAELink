import { NextResponse } from 'next/server'

const GITHUB_OWNER = 'Dry1ceD7'
const GITHUB_REPO = 'AAELink'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** Cache the latest release info for 5 minutes to avoid rate limits. */
let cache: { data: unknown; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

/** GET /api/updates/check — check GitHub for the latest release. */
export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const res = await fetch(GITHUB_API, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AAELink-Updater'
      },
      next: { revalidate: 300 }
    })

    if (!res.ok) {
      return NextResponse.json({
        error: 'github_api_error',
        status: res.status,
        message: res.statusText
      }, { status: 502 })
    }

    const release = await res.json() as {
      tag_name: string
      name: string
      body: string
      html_url: string
      published_at: string
      assets: Array<{
        name: string
        browser_download_url: string
        size: number
        download_count: number
      }>
    }

    const result = {
      latest_version: release.tag_name,
      name: release.name,
      notes: release.body,
      url: release.html_url,
      published_at: release.published_at,
      assets: release.assets.map(a => ({
        name: a.name,
        download_url: a.browser_download_url,
        size: a.size,
        downloads: a.download_count
      }))
    }

    cache = { data: result, ts: Date.now() }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({
      error: 'fetch_failed',
      message: (e as Error).message
    }, { status: 500 })
  }
}
