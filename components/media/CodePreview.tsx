'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Fragment, useEffect, useMemo, useState } from 'react'
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

// Token colors (VS Code "dark+" inspired). Inline so the highlighter stays
// dependency-free — no shiki/prismjs/highlight.js (Hard Rule 7).
const C = { keyword: '#569cd6', string: '#ce9178', comment: '#6a9955', number: '#b5cea8', plain: '#d4d4d4' }

// Extensions that get token coloring; anything else falls back to plain text.
const HIGHLIGHT_EXTS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'hpp',
  'cs', 'kt', 'scala', 'swift', 'dart', 'php', 'sql', 'css', 'vue', 'svelte',
  'py', 'rb', 'sh', 'bash', 'zsh', 'pl', 'lua', 'r',
])

// One merged keyword set spanning the supported languages. The tokenizer never
// mis-highlights non-keywords (they fall through to plain), so a shared set is
// safe and keeps the highlighter tiny.
const KEYWORD_SET = new Set([
  'if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var',
  'class', 'new', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch',
  'finally', 'throw', 'switch', 'case', 'break', 'continue', 'do', 'in', 'of', 'typeof',
  'instanceof', 'this', 'super', 'extends', 'implements', 'interface', 'type', 'enum',
  'public', 'private', 'protected', 'static', 'void', 'null', 'true', 'false', 'undefined',
  'def', 'elif', 'lambda', 'pass', 'with', 'as', 'yield', 'and', 'or', 'not', 'is', 'None',
  'True', 'False', 'self', 'fn', 'mut', 'struct', 'impl', 'pub', 'use', 'match',
  'package', 'func', 'go', 'defer', 'chan', 'map', 'select', 'end', 'then', 'echo',
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'AND', 'OR', 'NOT',
])

function ext(filename?: string, mime?: string): string {
  const e = filename?.split('.').pop()?.toLowerCase()
  if (e) return e
  return mime?.split('/').pop()?.replace('x-', '') || 'text'
}

function languageFromHints(language?: string, mime?: string, filename?: string): string {
  return language || ext(filename, mime)
}

// Single-line tokenizer. Splits a line into colored spans for strings, comments,
// numbers, and keywords. Intentionally minimal (no nested grammar, no multi-line
// state) — correctness over completeness; everything unmatched renders plain.
function tokenizeLine(line: string, keywords: Set<string>): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  const push = (text: string, color: string) => {
    out.push(<span key={key++} style={{ color }}>{text}</span>)
  }

  while (i < line.length) {
    const rest = line.slice(i)

    // Line comment (// … or # …) — runs to end of line.
    if (rest.startsWith('//') || rest[0] === '#') { push(rest, C.comment); break }

    // String literal — consume to the matching quote, skipping escapes.
    const q = line[i]
    if (q === '"' || q === "'" || q === '`') {
      let j = i + 1
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++ }
      j = Math.min(j + 1, line.length)
      push(line.slice(i, j), C.string)
      i = j
      continue
    }

    // Number (int / float / hex).
    const num = rest.match(/^(0x[0-9a-fA-F]+|\d+\.?\d*)/)
    if (num) { push(num[0], C.number); i += num[0].length; continue }

    // Identifier — colored as a keyword when it is one, else plain.
    const word = rest.match(/^[A-Za-z_$][\w$]*/)
    if (word) {
      push(word[0], keywords.has(word[0]) ? C.keyword : C.plain)
      i += word[0].length
      continue
    }

    // Operator / punctuation / whitespace.
    push(line[i], C.plain)
    i += 1
  }

  return out
}

/**
 * Lightweight code/text preview. Dependency-free (Hard Rule 7) coloring via a
 * minimal in-file tokenizer; unsupported languages / oversized files fall back
 * to plain selectable text.
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
  const highlight = HIGHLIGHT_EXTS.has(ext(filename, mime))
  const lines = useMemo(() => text.split('\n'), [text])

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
                <span style={S.text}>
                  {line === ''
                    ? ' '
                    : highlight
                      ? <Fragment>{tokenizeLine(line, KEYWORD_SET)}</Fragment>
                      : line}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#1e1e1e', color: '#d4d4d4', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: '#252526', flex: '0 0 auto' },
  lang: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 },
  body: { flex: 1, overflow: 'auto', background: '#1e1e1e' },
  pre: { margin: 0, padding: '8px 0', fontSize: 13, lineHeight: '1.5', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  line: { display: 'flex' },
  gutter: { flex: '0 0 auto', textAlign: 'right', paddingRight: 12, marginRight: 12, color: 'rgba(255,255,255,0.3)', userSelect: 'none', borderRight: '1px solid rgba(255,255,255,0.08)' },
  text: { whiteSpace: 'pre', flex: 1, paddingRight: 12 },
  status: { padding: '48px 24px', textAlign: 'center', color: 'var(--mm-muted)', fontSize: 14 },
}
