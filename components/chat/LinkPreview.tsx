'use client'

import { memo, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'

interface LinkMeta {
  title?: string
  description?: string
  image?: string
  domain?: string
}

/**
 * LinkPreview — auto-unfurls the first URL found in a message body.
 * Fetches metadata from /api/link-preview?url=... and renders a compact card.
 */
export const LinkPreview = memo(function LinkPreview({ url }: { url: string }) {
  const [meta, setMeta] = useState<LinkMeta | null>(null)
  const [failed, setFailed] = useState(false)

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

  if (failed) {
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

  if (!meta) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="link-preview-card"
    >
      {meta.image ? (
        <img
          src={meta.image}
          alt=""
          className="link-preview-image"
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : null}
      <div className="link-preview-body">
        <div className="link-preview-domain">
          <ExternalLink size={12} />
          <span>{meta.domain || new URL(url).hostname}</span>
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
