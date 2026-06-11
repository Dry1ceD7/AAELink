'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  EMOJI_DATA,
  CATEGORIES,
  CATEGORY_ICONS,
  SKIN_TONES,
  emojiMatches,
  applySkinTone,
  getFrequent,
  pushFrequent,
  getSkinTone,
  setSkinTone,
  type EmojiEntry
} from './emojiData'

// Re-export data + types so existing importers (Composer, ChatMessage) keep
// resolving `EMOJI_DATA` / `EmojiEntry` from this module.
export { EMOJI_DATA }
export type { EmojiEntry }

// ── Component ──────────────────────────────────────────────────────────────

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [tone, setTone] = useState<number>(() => getSkinTone())

  const frequent = useMemo(getFrequent, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    return EMOJI_DATA.filter(e => emojiMatches(e, query))
  }, [query])

  const handlePickEntry = (entry: EmojiEntry) => {
    const out = applySkinTone(entry, tone)
    pushFrequent(out)
    onSelect(out)
  }

  const handlePickRaw = (emoji: string) => {
    pushFrequent(emoji)
    onSelect(emoji)
  }

  const chooseTone = (idx: number) => {
    setTone(idx)
    setSkinTone(idx)
  }

  const displayList = filtered || (activeCategory
    ? EMOJI_DATA.filter(e => e.category === activeCategory)
    : null
  )

  return (
    <div className="emoji-picker" role="dialog" aria-label="Emoji picker"
      onClick={e => e.stopPropagation()}>
      {/* Search bar */}
      <div className="emoji-picker-search">
        <Search size={14} className="emoji-picker-search-icon" />
        <input
          type="text"
          placeholder="Search emoji or :alias:…"
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveCategory(null) }}
          autoFocus
          className="emoji-picker-input"
        />
        <button type="button" className="emoji-picker-close" onClick={onClose}
          aria-label="Close emoji picker">
          <X size={14} />
        </button>
      </div>

      {/* Skin-tone selector */}
      <div className="emoji-picker-tones" role="radiogroup" aria-label="Default skin tone"
        style={{ display: 'flex', gap: 2, padding: '4px 8px', alignItems: 'center' }}>
        {SKIN_TONES.map((t, idx) => (
          <button
            key={t.label}
            type="button"
            role="radio"
            aria-checked={tone === idx}
            className={`emoji-picker-tone-btn${tone === idx ? ' emoji-picker-tone-btn--active' : ''}`}
            title={`Skin tone: ${t.label}`}
            onClick={() => chooseTone(idx)}
            style={{
              border: 'none',
              cursor: 'pointer',
              fontSize: 15,
              lineHeight: 1,
              padding: '2px 3px',
              borderRadius: 6,
              background: tone === idx ? 'var(--mm-row-hover, rgba(0,0,0,0.08))' : 'transparent',
              boxShadow: tone === idx ? 'inset 0 -2px 0 var(--mm-accent, #1264a3)' : 'none',
              opacity: tone === idx ? 1 : 0.65
            }}
          >
            {t.swatch}
          </button>
        ))}
      </div>

      {/* Category tabs */}
      <div className="emoji-picker-categories">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            type="button"
            className={`emoji-picker-cat-btn${activeCategory === cat ? ' emoji-picker-cat-btn--active' : ''}`}
            title={cat}
            onClick={() => { setActiveCategory(activeCategory === cat ? null : cat); setQuery('') }}
          >
            {CATEGORY_ICONS[cat]}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="emoji-picker-grid-wrap">
        {/* Frequent section */}
        {!displayList && frequent.length > 0 && (
          <>
            <div className="emoji-picker-section-label">Frequently used</div>
            <div className="emoji-picker-grid">
              {frequent.map(e => (
                <button key={`freq-${e}`} type="button" className="emoji-picker-btn"
                  title={e} onClick={() => handlePickRaw(e)}>
                  {e}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Filtered / single-category */}
        {displayList ? (
          <div className="emoji-picker-grid">
            {displayList.map(e => (
              <button key={e.emoji} type="button" className="emoji-picker-btn"
                title={e.name} onClick={() => handlePickEntry(e)}>
                {applySkinTone(e, tone)}
              </button>
            ))}
            {displayList.length === 0 && (
              <div className="emoji-picker-empty">No emoji found</div>
            )}
          </div>
        ) : (
          <>
            {CATEGORIES.map(cat => (
              <div key={cat}>
                <div className="emoji-picker-section-label">{cat}</div>
                <div className="emoji-picker-grid">
                  {EMOJI_DATA.filter(e => e.category === cat).map(e => (
                    <button key={e.emoji} type="button" className="emoji-picker-btn"
                      title={e.name} onClick={() => handlePickEntry(e)}>
                      {applySkinTone(e, tone)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
