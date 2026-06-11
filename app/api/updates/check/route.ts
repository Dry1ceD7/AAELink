// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'

const GITHUB_OWNER = 'Dry1ceD7'
const GITHUB_REPO = 'AAELink'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** Cache the latest release info for 5 minutes to avoid rate limits. */
let cache: { data: unknown; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

/**
 * Compare two semver-ish version strings.
 * Returns: -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a: string, b: string): number {
  const normalize = (v: string) => v.replace(/^v/, '').replace(/-.*$/, '')
  const pa = normalize(a).split('.').map(Number)
  const pb = normalize(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

/**
 * Classify an asset by target platform.
 */
function classifyAsset(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.dmg') || lower.includes('mac') || lower.includes('darwin')) return 'macos'
  if (lower.endsWith('.exe') || lower.includes('win') || lower.includes('setup')) return 'windows'
  if (lower.endsWith('.appimage') || lower.endsWith('.deb') || lower.endsWith('.rpm') || lower.includes('linux')) return 'linux'
  if (lower.endsWith('.zip') || lower.endsWith('.tar.gz')) {
    if (lower.includes('mac') || lower.includes('darwin')) return 'macos'
    if (lower.includes('win')) return 'windows'
    return 'archive'
  }
  if (lower === 'latest.yml' || lower === 'latest-mac.yml') return 'meta'
  return 'other'
}

/**
 * GET /api/updates/check — check GitHub for the latest release.
 *
 * Optional query params:
 *  - current_version: client's current version for comparison
 *  - platform: "macos" | "windows" | "linux" to filter assets
 */
async function _GET(req: NextRequest) {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return buildResponse(cache.data as ReleaseData, req)
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
      prerelease: boolean
      assets: Array<{
        name: string
        browser_download_url: string
        size: number
        download_count: number
        content_type: string
      }>
    }

    const result: ReleaseData = {
      latest_version: release.tag_name,
      name: release.name,
      notes: release.body,
      url: release.html_url,
      published_at: release.published_at,
      prerelease: release.prerelease,
      assets: release.assets.map(a => ({
        name: a.name,
        download_url: a.browser_download_url,
        size: a.size,
        downloads: a.download_count,
        content_type: a.content_type,
        platform: classifyAsset(a.name)
      }))
    }

    cache = { data: result, ts: Date.now() }
    return buildResponse(result, req)
  } catch (e) {
    return NextResponse.json({
      error: 'fetch_failed',
      message: (e as Error).message
    }, { status: 500 })
  }
}

interface AssetData {
  name: string
  download_url: string
  size: number
  downloads: number
  content_type: string
  platform: string
}

interface ReleaseData {
  latest_version: string
  name: string
  notes: string
  url: string
  published_at: string
  prerelease: boolean
  assets: AssetData[]
}

function buildResponse(data: ReleaseData, req: NextRequest) {
  const currentVersion = req.nextUrl.searchParams.get('current_version')?.trim() || ''
  const platform = req.nextUrl.searchParams.get('platform')?.trim().toLowerCase() || ''

  let filteredAssets = data.assets
  if (platform) {
    filteredAssets = data.assets.filter(a => a.platform === platform)
  }

  let update_available: boolean | null = null
  if (currentVersion) {
    update_available = compareVersions(currentVersion, data.latest_version) < 0
  }

  return NextResponse.json({
    latest_version: data.latest_version,
    name: data.name,
    notes: data.notes,
    url: data.url,
    published_at: data.published_at,
    prerelease: data.prerelease,
    update_available,
    current_version: currentVersion || undefined,
    assets: filteredAssets,
    total_assets: data.assets.length
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/updates/check', _GET)
