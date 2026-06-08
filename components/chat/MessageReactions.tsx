'use client'

import { useEffect, useRef, useState } from 'react'
import { Smile } from 'lucide-react'
import { type ReactionSummary } from '@/lib/messaging/reactions'
import { ReactionUsers } from './ReactionUsers'

// ── Reaction icons (Lucide-mapped, no heavy emoji deps) ────────────────────
const REACTION_ICON: Record<string, string> = {
  thumbs_up: '👍',
  heart: '❤️',
  check: '✅',
  smile: '😊',
  eye: '👀'
}

export function MessageReactions({
  messageId,
  reactions,
  reactBusy,
  toggleReaction,
  onOpenPicker,
}: {
  messageId: string,
  reactions?: ReactionSummary[],
  reactBusy: boolean,
  toggleReaction: (k: string) => void,
  onOpenPicker?: () => void,
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])

  const openHover = (key: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHoverKey(key), 350)
  }
  const closeHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoverKey(null)
  }

  if (!reactions || reactions.length === 0) return null
  return (
    <div className="reaction-row">
      {reactions.map(r => {
        const readable = r.key.replace(/_/g, ' ')
        return (
        <span
          key={r.key}
          style={{ position: 'relative', display: 'inline-flex' }}
          onMouseEnter={() => openHover(r.key)}
          onMouseLeave={closeHover}
        >
          <button
            type="button"
            className={`reaction-chip${r.me ? ' reaction-chip--mine' : ''}`}
            title={readable}
            aria-pressed={r.me}
            aria-label={`${readable} — ${r.count} reaction${r.count !== 1 ? 's' : ''}${r.me ? ', you reacted' : ''}`}
            onClick={() => void toggleReaction(r.key)}
            onFocus={() => setHoverKey(r.key)}
            onBlur={closeHover}
            disabled={reactBusy}
          >
            <span className="reaction-emoji" aria-hidden="true">{REACTION_ICON[r.key] || r.key}</span>
            <span className="reaction-count">{r.count}</span>
          </button>
          {hoverKey === r.key ? (
            <ReactionUsers messageId={messageId} emoji={r.key} label={readable} />
          ) : null}
        </span>
        )
      })}
      {onOpenPicker && (
        <button
          type="button"
          className="reaction-chip reaction-chip--add"
          title="Add a reaction"
          aria-label="Add a reaction"
          onClick={onOpenPicker}
          disabled={reactBusy}
        >
          <Smile size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
