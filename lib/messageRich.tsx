import type { ReactNode } from 'react'

type BlockSeg =
  | { kind: 'plain'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'olist'; items: string[] }
  | { kind: 'ulist'; items: string[] }

/** Split on blockquotes (`> line`), numbered lists (`1. item`), and bullets (`- item` / `* item`). */
export function segmentMessageBlocks(raw: string): BlockSeg[] {
  const lines = raw.split('\n')
  const out: BlockSeg[] = []
  const buf: string[] = []
  const flushBuf = () => {
    if (buf.length) {
      out.push({ kind: 'plain', text: buf.join('\n') })
      buf.length = 0
    }
  }

  let i = 0
  while (i < lines.length) {
    const L = lines[i]!
    if (L === '') {
      buf.push('')
      i++
      continue
    }
    if (/^>\s?/.test(L)) {
      flushBuf()
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        q.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      out.push({ kind: 'quote', lines: q })
      continue
    }
    if (/^\d+\.\s/.test(L)) {
      flushBuf()
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s+/, ''))
        i++
      }
      out.push({ kind: 'olist', items })
      continue
    }
    if (/^-\s+/.test(L) || /^\*\s+/.test(L)) {
      flushBuf()
      const items: string[] = []
      while (i < lines.length && (/^-\s+/.test(lines[i]!) || /^\*\s+/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ''))
        i++
      }
      out.push({ kind: 'ulist', items })
      continue
    }
    buf.push(L)
    i++
  }
  flushBuf()
  return out
}

/** Allow only http(s) links in rendered messages. */
function safeHref(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (t.startsWith('/')) return t
  if (t.startsWith('mailto:')) return t
  try {
    const u = new URL(t)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

const LINK_RE = /^\[([^\]]*)\]\(([^)]*)\)/

const GROUP_MENTIONS = new Set(['here', 'channel', 'all'])

function withMentions(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return []
  const parts = text.split(/(@[a-zA-Z0-9._-]+)/g)
  return parts.map((p, idx) => {
    if (/^@[a-zA-Z0-9._-]+$/.test(p)) {
      const username = p.slice(1) // strip leading @
      const isGroup = GROUP_MENTIONS.has(username)
      return (
        <button
          key={`${keyPrefix}-m${idx}`}
          type="button"
          className={`mm-mention mm-mention--interactive${isGroup ? ' mm-mention--group' : ''}`}
          data-mention-username={username}
          title={isGroup ? `Notify ${username === 'here' ? 'online members' : 'all members'} in this channel` : `View ${p}'s profile`}
        >
          {p}
        </button>
      )
    }
    return p
  })
}

function nextSpecialIndex(s: string, from: number): number {
  for (let p = from; p < s.length; p++) {
    const ch = s[p]
    if (ch === '`' || ch === '[') return p
    if (ch === '*') return p
  }
  return -1
}

/**
 * Renders a subset of Slack-style markup using React nodes only (no HTML injection).
 * Supported: **bold**, *italic*, `code`, [label](https://url), @handles (styled only).
 * Block structure: `> ` quotes, `1. ` lists, `- ` / `* ` bullet lists (see `segmentMessageBlocks`).
 */
export function parseMessageRichText(s: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  let seq = 0
  const key = () => `${keyBase}-${seq++}`

  while (i < s.length) {
    if (s.slice(i, i + 2) === '**') {
      const end = s.indexOf('**', i + 2)
      if (end === -1) {
        out.push(...withMentions(s[i]!, key()))
        i += 1
        continue
      }
      const inner = s.slice(i + 2, end)
      out.push(
        <strong key={key()}>
          {inner.length ? parseMessageRichText(inner, `${keyBase}:b${i}`) : null}
        </strong>
      )
      i = end + 2
      continue
    }

    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1)
      if (end === -1) {
        out.push(...withMentions(s[i]!, key()))
        i += 1
        continue
      }
      out.push(
        <code key={key()} className="mm-inline-code">
          {s.slice(i + 1, end)}
        </code>
      )
      i = end + 1
      continue
    }

    if (s[i] === '[') {
      const rest = s.slice(i)
      const m = rest.match(LINK_RE)
      if (m) {
        const href = safeHref(m[2] ?? '')
        if (href) {
          const label = m[1] ?? ''
          if (href.startsWith('/api/documents/') && label.toLowerCase().match(/\.(png|jpe?g|gif|webp)(\s|\]|$)/)) {
            out.push(
              <span key={key()} style={{ display: 'block', marginTop: '8px' }}>
                <a href={href} target="_blank" rel="noopener noreferrer" className="mm-rich-link" style={{ display: 'block', marginBottom: '4px' }}>
                  {label}
                </a>
                <img src={href} alt={label} style={{ maxWidth: '100%', maxHeight: '320px', borderRadius: '8px', objectFit: 'contain', backgroundColor: 'var(--c-bg-tertiary)' }} />
              </span>
            )
          } else {
            out.push(
              <a key={key()} href={href} target="_blank" rel="noopener noreferrer" className="mm-rich-link">
                {label}
              </a>
            )
          }
          i += m[0].length
          continue
        }
      }
      out.push(...withMentions(s[i]!, key()))
      i += 1
      continue
    }

    if (s[i] === '*') {
      const end = s.indexOf('*', i + 1)
      if (end === -1) {
        out.push(...withMentions(s[i]!, key()))
        i += 1
        continue
      }
      const inner = s.slice(i + 1, end)
      out.push(
        <em key={key()}>{inner.length ? parseMessageRichText(inner, `${keyBase}:i${i}`) : null}</em>
      )
      i = end + 1
      continue
    }

    const ns = nextSpecialIndex(s, i)
    if (ns === -1) {
      out.push(...withMentions(s.slice(i), key()))
      break
    }
    if (ns > i) {
      out.push(...withMentions(s.slice(i, ns), key()))
      i = ns
      continue
    }
  }

  return out
}

export function MessageRichText({ text }: { text: string }) {
  const segs = segmentMessageBlocks(text)
  if (segs.length === 1 && segs[0]!.kind === 'plain') {
    return <span className="mm-rich-text">{parseMessageRichText(segs[0]!.text, 'mr')}</span>
  }

  return (
    <div className="mm-rich-blocks">
      {segs.map((s, si) => {
        const kb = `mr-${si}`
        if (s.kind === 'plain') {
          return (
            <span key={kb} className="mm-rich-text mm-rich-block">
              {parseMessageRichText(s.text, kb)}
            </span>
          )
        }
        if (s.kind === 'quote') {
          return (
            <blockquote key={kb} className="mm-rich-blockquote">
              {s.lines.map((ln, li) => (
                <span key={li} className="mm-rich-quote-line">
                  {parseMessageRichText(ln, `${kb}-q${li}`)}
                </span>
              ))}
            </blockquote>
          )
        }
        if (s.kind === 'olist') {
          return (
            <ol key={kb} className="mm-rich-ol">
              {s.items.map((it, ii) => (
                <li key={ii}>{parseMessageRichText(it, `${kb}-li${ii}`)}</li>
              ))}
            </ol>
          )
        }
        return (
          <ul key={kb} className="mm-rich-ul">
            {s.items.map((it, ii) => (
              <li key={ii}>{parseMessageRichText(it, `${kb}-uli${ii}`)}</li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}
