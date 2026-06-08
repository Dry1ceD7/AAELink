'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface Props {
  // Provide either a URL to fetch the text from, or the raw content directly.
  url?: string
  content?: string
  // Optional language label (purely informational header text).
  language?: string
  mime?: string
  filename?: string
}

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB cap — refuse to render huge blobs inline

function languageFromHints(language?: string, mime?: string, filename?: string): string {
  if (language) return language
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext) return ext
  }
  if (mime) {
    const sub = mime.split('/').pop()?.replace('x-', '')
    if (sub) return sub
  }
  return 'text'
}

/**
 * Lightweight code/text preview. No syntax-highlight dependency is present in
 * package.json, so this renders monospace text with line numbers and a copy
 * button rather than pulling in a heavy highlighter. Correctness over fancy
 * coloring — the text is shown verbatim and is selectable/copyable.
 */
export function CodePreview({ url, content, language, mime, filename }: Props) {
  const [text, setText] = useState<string>(content ?? '')
  const [loading, setLoading] = useState<boolean>(content === undefined)
  const [error, setError] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (content !== undefined || !url) return
    let cancelled = false
    setLoading(true)
    setError('')
    apiFetch(url)
      .then(async res => {
        if (!res.ok) throw new Error(`load_failed_${res.status}`)
        const len = Number(res.headers.get('content-length') || '0')
        if (len > MAX_BYTES) throw new Error('file_too_large')
        const body = await res.text()
        if (body.length > MAX_BYTES) throw new Error('file_too_large')
        return body
      })
      .then(body => { if (!cancelled) setText(body) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'load_failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [url, content])

  const onCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* clipboard unavailable; no-op */ })
  }

  const label = languageFromHints(language, mime, filename)

  if (loading) {
    return <div style={S.status}>Loading...</div>
  }
  if (error) {
    return (
      <div style={S.status}>
        {error === 'file_too_large'
          ? 'File is too large to preview inline. Download to view.'
          : 'Could not load file contents.'}
      </div>
    )
  }

  const lines = text.split('\n')
  const gutterWidth = `${String(lines.length).length + 1}ch`

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.lang}>{label}</span>
        <button type="button" className="mm-icon-btn" title="Copy" onClick={onCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <div style={S.body}>
        <pre style={S.pre}>
          <code>
            {lines.map((line, i) => (
              <span key={i} style={S.line}>
                <span style={{ ...S.gutter, width: gutterWidth }} aria-hidden="true">{i + 1}</span>
                <span style={S.text}>{line === '' ? ' ' : line}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
    background: '#1e1e1e', color: '#d4d4d4', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)',
    background: '#252526', flex: '0 0 auto',
  },
  lang: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 },
  body: { flex: 1, overflow: 'auto', background: '#1e1e1e' },
  pre: { margin: 0, padding: '8px 0', fontSize: 13, lineHeight: '1.5', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  line: { display: 'flex' },
  gutter: {
    flex: '0 0 auto', textAlign: 'right', paddingRight: 12, marginRight: 12,
    color: 'rgba(255,255,255,0.3)', userSelect: 'none',
    borderRight: '1px solid rgba(255,255,255,0.08)',
  },
  text: { whiteSpace: 'pre', flex: 1, paddingRight: 12 },
  status: { padding: '48px 24px', textAlign: 'center', color: 'var(--mm-muted)', fontSize: 14 },
}
