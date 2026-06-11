'use client'

import { memo, useEffect, useState, type CSSProperties } from 'react'
import { ExternalLink, Play } from 'lucide-react'

interface LinkMeta {
  title?: string
  description?: string
  image?: string
  domain?: string
}

interface MediaEmbed {
  kind: 'video' | 'audio'
  src: string
}

/**
 * Detect a known rich-media provider from a URL and return an embeddable
 * iframe src. Returns null for anything not recognized, so the caller falls
 * back to the static metadata card.
 */
function detectEmbed(rawUrl: string): MediaEmbed | null {
  let u: URL
  try { u = new URL(rawUrl) } catch { return null }
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  const path = u.pathname
  const yt = (id: string): MediaEmbed => ({ kind: 'video', src: `https://www.youtube-nocookie.com/embed/${id}` })

  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0]
    if (id) return yt(id)
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v')
    if (v) return yt(v)
    const m = path.match(/^\/(?:shorts|embed)\/([\w-]+)/)
    if (m) return yt(m[1])
  }
  if (host === 'vimeo.com') {
    const m = path.match(/^\/(\d+)/)
    if (m) return { kind: 'video', src: `https://player.vimeo.com/video/${m[1]}` }
  }
  if (host === 'player.vimeo.com') {
    const m = path.match(/^\/video\/(\d+)/)
    if (m) return { kind: 'video', src: `https://player.vimeo.com/video/${m[1]}` }
  }
  if (host === 'loom.com') {
    const m = path.match(/^\/share\/([\w-]+)/)
    if (m) return { kind: 'video', src: `https://www.loom.com/embed/${m[1]}` }
  }
  if (host === 'open.spotify.com') {
    const m = path.match(/^\/(track|album|playlist|episode|show)\/(\w+)/)
    if (m) return { kind: 'audio', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` }
  }
  if (host === 'soundcloud.com' && /^\/[\w-]+(?:\/[\w-]+)*\/?$/.test(path) && path.length > 1) {
    // Never forward the raw user URL (it may carry an attacker-controlled host,
    // query, or fragment). Rebuild a canonical track URL from the validated host
    // + path only, then hand that to the SoundCloud player.
    const canonical = `https://soundcloud.com${path}`
    return { kind: 'audio', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}&visual=false` }
  }
  return null
}

const wrap16x9: CSSProperties = {
  position: 'relative', width: '100%', maxWidth: 480, paddingTop: '56.25%',
  borderRadius: 8, overflow: 'hidden', background: '#000',
}
const iframeFill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }
const audioFrame: CSSProperties = { width: '100%', maxWidth: 480, height: 152, border: 0, borderRadius: 8 }
const playBtn: CSSProperties = {
  position: 'relative', cursor: 'pointer', textAlign: 'left', border: 'none',
  padding: 0, width: '100%', maxWidth: 480, background: 'transparent',
}
const overlay: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'rgba(0,0,0,0.28)',
}
const playDisc: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48,
  borderRadius: '50%', background: 'rgba(0,0,0,0.65)', color: '#fff',
}

function ActivePlayer({ embed, title }: { embed: MediaEmbed; title?: string }) {
  if (embed.kind === 'video') {
    return (
      <div style={wrap16x9}>
        <iframe
          src={embed.src}
          title={title || 'Embedded video'}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          style={iframeFill}
        />
      </div>
    )
  }
  return (
    <iframe
      src={embed.src}
      title={title || 'Embedded audio'}
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      allow="autoplay; clipboard-write; encrypted-media"
      loading="lazy"
      style={audioFrame}
    />
  )
}

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none'
}

function safeHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

/**
 * LinkPreview — auto-unfurls the first URL found in a message body.
 * Fetches metadata from /api/link-preview?url=... and renders a compact card.
 * Known media providers render a lazy (click-to-load) inline player instead.
 */
export const LinkPreview = memo(function LinkPreview({ url }: { url: string }) {
  const [meta, setMeta] = useState<LinkMeta | null>(null)
  const [failed, setFailed] = useState(false)
  const [activated, setActivated] = useState(false)

  const embed = detectEmbed(url)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    const fetchMeta = async () => {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
        if (!res.ok) throw new Error('fetch failed')
        const data = (await res.json().catch(() => ({}))) as LinkMeta
        if (!cancelled && (data.title || data.description)) setMeta(data)
        else if (!cancelled) setFailed(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void fetchMeta()
    return () => { cancelled = true }
  }, [url])

  if (embed && activated) {
    return <ActivePlayer embed={embed} title={meta?.title} />
  }

  if (failed && !embed) {
    return (
      <div className="link-preview-card link-preview-card--unavailable">
        <div className="link-preview-body">
          <div className="link-preview-domain">
            <ExternalLink size={12} />
            <span>Link preview unavailable</span>
          </div>
        </div>
      </div>
    )
  }

  // Known media provider: card with a play overlay (click-to-load for privacy).
  if (embed) {
    return (
      <button
        type="button"
        onClick={() => setActivated(true)}
        aria-label={`Play ${meta?.title || embed.kind}`}
        className="link-preview-card"
        style={playBtn}
      >
        <div style={{ position: 'relative', width: '100%' }}>
          {meta?.image ? (
            <img src={meta.image} alt="" className="link-preview-image" loading="lazy" onError={hideOnError} />
          ) : null}
          <span style={overlay}>
            <span style={playDisc}><Play size={22} fill="#fff" /></span>
          </span>
        </div>
        <div className="link-preview-body">
          <div className="link-preview-domain">
            <ExternalLink size={12} />
            <span>{meta?.domain || safeHost(url)}</span>
          </div>
          {meta?.title ? <div className="link-preview-title">{meta.title}</div> : null}
        </div>
      </button>
    )
  }

  if (!meta) return null

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="link-preview-card">
      {meta.image ? (
        <img src={meta.image} alt="" className="link-preview-image" loading="lazy" onError={hideOnError} />
      ) : null}
      <div className="link-preview-body">
        <div className="link-preview-domain">
          <ExternalLink size={12} />
          <span>{meta.domain || safeHost(url)}</span>
        </div>
        {meta.title ? <div className="link-preview-title">{meta.title}</div> : null}
        {meta.description ? (
          <div className="link-preview-desc">{meta.description.slice(0, 200)}</div>
        ) : null}
      </div>
    </a>
  )
})

const URL_REGEX = /https?:\/\/[^\s<>)\]]+/

/** Extract the first URL from a message for preview purposes. */
export function extractPreviewUrl(message: string): string | null {
  // Skip internal document/API links
  const m = message.match(URL_REGEX)
  if (!m) return null
  const url = m[0]
  // Don't preview internal links or very short URLs
  if (url.includes('/api/') || url.length < 15) return null
  return url
}
