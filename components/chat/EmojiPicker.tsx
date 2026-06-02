'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

// ── Emoji Data — Compact but comprehensive set ─────────────────────────────

export interface EmojiEntry {
  emoji: string
  name: string
  category: string
}

export const EMOJI_DATA: EmojiEntry[] = [
  // Smileys & People
  { emoji: '😀', name: 'grinning', category: 'Smileys' },
  { emoji: '😃', name: 'smiley', category: 'Smileys' },
  { emoji: '😄', name: 'smile', category: 'Smileys' },
  { emoji: '😁', name: 'grin', category: 'Smileys' },
  { emoji: '😅', name: 'sweat smile', category: 'Smileys' },
  { emoji: '😂', name: 'joy', category: 'Smileys' },
  { emoji: '🤣', name: 'rofl', category: 'Smileys' },
  { emoji: '😊', name: 'blush', category: 'Smileys' },
  { emoji: '😇', name: 'innocent', category: 'Smileys' },
  { emoji: '🙂', name: 'slightly smiling', category: 'Smileys' },
  { emoji: '😉', name: 'wink', category: 'Smileys' },
  { emoji: '😍', name: 'heart eyes', category: 'Smileys' },
  { emoji: '🥰', name: 'smiling with hearts', category: 'Smileys' },
  { emoji: '😘', name: 'kissing heart', category: 'Smileys' },
  { emoji: '😋', name: 'yum', category: 'Smileys' },
  { emoji: '😎', name: 'sunglasses', category: 'Smileys' },
  { emoji: '🤩', name: 'star struck', category: 'Smileys' },
  { emoji: '🥳', name: 'partying', category: 'Smileys' },
  { emoji: '😏', name: 'smirk', category: 'Smileys' },
  { emoji: '😒', name: 'unamused', category: 'Smileys' },
  { emoji: '😔', name: 'pensive', category: 'Smileys' },
  { emoji: '😢', name: 'cry', category: 'Smileys' },
  { emoji: '😭', name: 'sob', category: 'Smileys' },
  { emoji: '😤', name: 'triumph', category: 'Smileys' },
  { emoji: '🤔', name: 'thinking', category: 'Smileys' },
  { emoji: '🤗', name: 'hugging', category: 'Smileys' },
  { emoji: '🤭', name: 'hand over mouth', category: 'Smileys' },
  { emoji: '🤫', name: 'shushing', category: 'Smileys' },
  { emoji: '🤐', name: 'zipper mouth', category: 'Smileys' },
  { emoji: '😴', name: 'sleeping', category: 'Smileys' },
  { emoji: '🤯', name: 'exploding head', category: 'Smileys' },
  { emoji: '😱', name: 'scream', category: 'Smileys' },
  { emoji: '🥺', name: 'pleading', category: 'Smileys' },
  { emoji: '😈', name: 'smiling imp', category: 'Smileys' },
  { emoji: '🤡', name: 'clown', category: 'Smileys' },
  { emoji: '💀', name: 'skull', category: 'Smileys' },
  { emoji: '👻', name: 'ghost', category: 'Smileys' },
  { emoji: '🙄', name: 'eye roll', category: 'Smileys' },
  { emoji: '😬', name: 'grimacing', category: 'Smileys' },
  { emoji: '🫡', name: 'salute', category: 'Smileys' },

  // Gestures & Body
  { emoji: '👍', name: 'thumbs up', category: 'Gestures' },
  { emoji: '👎', name: 'thumbs down', category: 'Gestures' },
  { emoji: '👏', name: 'clap', category: 'Gestures' },
  { emoji: '🙌', name: 'raised hands', category: 'Gestures' },
  { emoji: '🤝', name: 'handshake', category: 'Gestures' },
  { emoji: '✊', name: 'fist', category: 'Gestures' },
  { emoji: '👊', name: 'fist bump', category: 'Gestures' },
  { emoji: '✌️', name: 'peace', category: 'Gestures' },
  { emoji: '🤞', name: 'crossed fingers', category: 'Gestures' },
  { emoji: '🤙', name: 'call me', category: 'Gestures' },
  { emoji: '👋', name: 'wave', category: 'Gestures' },
  { emoji: '🖐️', name: 'raised hand', category: 'Gestures' },
  { emoji: '💪', name: 'muscle', category: 'Gestures' },
  { emoji: '🙏', name: 'pray', category: 'Gestures' },
  { emoji: '🫶', name: 'heart hands', category: 'Gestures' },
  { emoji: '👀', name: 'eyes', category: 'Gestures' },
  { emoji: '🧠', name: 'brain', category: 'Gestures' },
  { emoji: '🫠', name: 'melting', category: 'Gestures' },

  // Hearts & Symbols
  { emoji: '❤️', name: 'red heart', category: 'Hearts' },
  { emoji: '🧡', name: 'orange heart', category: 'Hearts' },
  { emoji: '💛', name: 'yellow heart', category: 'Hearts' },
  { emoji: '💚', name: 'green heart', category: 'Hearts' },
  { emoji: '💙', name: 'blue heart', category: 'Hearts' },
  { emoji: '💜', name: 'purple heart', category: 'Hearts' },
  { emoji: '🖤', name: 'black heart', category: 'Hearts' },
  { emoji: '🤍', name: 'white heart', category: 'Hearts' },
  { emoji: '💔', name: 'broken heart', category: 'Hearts' },
  { emoji: '💯', name: 'hundred', category: 'Hearts' },
  { emoji: '💥', name: 'boom', category: 'Hearts' },
  { emoji: '⭐', name: 'star', category: 'Hearts' },
  { emoji: '🌟', name: 'glowing star', category: 'Hearts' },
  { emoji: '✨', name: 'sparkles', category: 'Hearts' },
  { emoji: '🔥', name: 'fire', category: 'Hearts' },
  { emoji: '💡', name: 'light bulb', category: 'Hearts' },

  // Objects & Work
  { emoji: '✅', name: 'check', category: 'Objects' },
  { emoji: '❌', name: 'cross mark', category: 'Objects' },
  { emoji: '⚠️', name: 'warning', category: 'Objects' },
  { emoji: '🚀', name: 'rocket', category: 'Objects' },
  { emoji: '🎯', name: 'target', category: 'Objects' },
  { emoji: '🏆', name: 'trophy', category: 'Objects' },
  { emoji: '🎉', name: 'party', category: 'Objects' },
  { emoji: '🎊', name: 'confetti', category: 'Objects' },
  { emoji: '📎', name: 'paperclip', category: 'Objects' },
  { emoji: '📌', name: 'pushpin', category: 'Objects' },
  { emoji: '📋', name: 'clipboard', category: 'Objects' },
  { emoji: '📝', name: 'memo', category: 'Objects' },
  { emoji: '📅', name: 'calendar', category: 'Objects' },
  { emoji: '📊', name: 'bar chart', category: 'Objects' },
  { emoji: '💻', name: 'laptop', category: 'Objects' },
  { emoji: '🖥️', name: 'desktop', category: 'Objects' },
  { emoji: '⚙️', name: 'gear', category: 'Objects' },
  { emoji: '🔧', name: 'wrench', category: 'Objects' },
  { emoji: '🔒', name: 'lock', category: 'Objects' },
  { emoji: '🔑', name: 'key', category: 'Objects' },
  { emoji: '📣', name: 'megaphone', category: 'Objects' },
  { emoji: '💬', name: 'speech bubble', category: 'Objects' },
  { emoji: '⏰', name: 'alarm clock', category: 'Objects' },
  { emoji: '☕', name: 'coffee', category: 'Objects' },
  { emoji: '🍕', name: 'pizza', category: 'Objects' },
  { emoji: '🍔', name: 'hamburger', category: 'Objects' },
  { emoji: '🍻', name: 'clinking beers', category: 'Objects' },
  { emoji: '🎵', name: 'music notes', category: 'Objects' },
  { emoji: '🔴', name: 'red circle', category: 'Objects' },
  { emoji: '🟢', name: 'green circle', category: 'Objects' },
  { emoji: '🟡', name: 'yellow circle', category: 'Objects' },
  { emoji: '🔵', name: 'blue circle', category: 'Objects' },

  // Nature
  { emoji: '🌈', name: 'rainbow', category: 'Nature' },
  { emoji: '☀️', name: 'sun', category: 'Nature' },
  { emoji: '🌙', name: 'moon', category: 'Nature' },
  { emoji: '🌊', name: 'wave', category: 'Nature' },
  { emoji: '🌸', name: 'cherry blossom', category: 'Nature' },
  { emoji: '🌻', name: 'sunflower', category: 'Nature' },
  { emoji: '🍀', name: 'four leaf clover', category: 'Nature' },
  { emoji: '🐶', name: 'dog', category: 'Nature' },
  { emoji: '🐱', name: 'cat', category: 'Nature' },
  { emoji: '🦊', name: 'fox', category: 'Nature' },
  { emoji: '🐻', name: 'bear', category: 'Nature' },
  { emoji: '🦁', name: 'lion', category: 'Nature' },

  // Flags / Misc
  { emoji: '🏁', name: 'checkered flag', category: 'Flags' },
  { emoji: '🚩', name: 'red flag', category: 'Flags' },
  { emoji: '🏳️', name: 'white flag', category: 'Flags' },
  { emoji: '🇹🇭', name: 'thailand', category: 'Flags' },
  { emoji: '🇺🇸', name: 'us', category: 'Flags' },
  { emoji: '🇯🇵', name: 'japan', category: 'Flags' },
  { emoji: '🇬🇧', name: 'uk', category: 'Flags' },
]

const CATEGORIES = ['Smileys', 'Gestures', 'Hearts', 'Objects', 'Nature', 'Flags'] as const

const CATEGORY_ICONS: Record<string, string> = {
  Smileys: '😀',
  Gestures: '👍',
  Hearts: '❤️',
  Objects: '🚀',
  Nature: '🌿',
  Flags: '🏁',
}

// ── Frequently-used emojis (stored in localStorage) ──────────────────────
const FREQ_KEY = 'aaelink-emoji-freq'
const MAX_RECENT = 16

function getFrequent(): string[] {
  try {
    const raw = localStorage.getItem(FREQ_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch { return [] }
}

function pushFrequent(emoji: string) {
  try {
    const cur = getFrequent().filter(e => e !== emoji)
    cur.unshift(emoji)
    localStorage.setItem(FREQ_KEY, JSON.stringify(cur.slice(0, MAX_RECENT)))
  } catch { /* noop */ }
}

// ── Component ──────────────────────────────────────────────────────────────

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const frequent = useMemo(getFrequent, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return EMOJI_DATA.filter(e =>
      e.name.includes(q) || e.emoji.includes(q)
    )
  }, [query])

  const handlePick = (emoji: string) => {
    pushFrequent(emoji)
    onSelect(emoji)
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
          placeholder="Search emoji…"
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
                  title={e} onClick={() => handlePick(e)}>
                  {e}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Filtered / all */}
        {displayList ? (
          <div className="emoji-picker-grid">
            {displayList.map(e => (
              <button key={e.emoji} type="button" className="emoji-picker-btn"
                title={e.name} onClick={() => handlePick(e.emoji)}>
                {e.emoji}
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
                      title={e.name} onClick={() => handlePick(e.emoji)}>
                      {e.emoji}
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
