// ── Emoji data + helpers (shared by EmojiPicker and the composer) ──────────
// Extracted from EmojiPicker.tsx to keep that component under the 250-line cap.

export interface EmojiEntry {
  emoji: string
  name: string
  category: string
  /** Short colon-aliases used for `:alias:` search (e.g. '+1', 'thumbsup'). */
  aliases?: string[]
  /** True when this emoji accepts a Fitzpatrick skin-tone modifier. */
  skinTonable?: boolean
}

export const EMOJI_DATA: EmojiEntry[] = [
  // Smileys & People
  { emoji: '😀', name: 'grinning', category: 'Smileys', aliases: ['grinning'] },
  { emoji: '😃', name: 'smiley', category: 'Smileys', aliases: ['smiley'] },
  { emoji: '😄', name: 'smile', category: 'Smileys', aliases: ['smile'] },
  { emoji: '😁', name: 'grin', category: 'Smileys', aliases: ['grin'] },
  { emoji: '😅', name: 'sweat smile', category: 'Smileys', aliases: ['sweat_smile'] },
  { emoji: '😂', name: 'joy', category: 'Smileys', aliases: ['joy', 'lol'] },
  { emoji: '🤣', name: 'rofl', category: 'Smileys', aliases: ['rofl', 'rolling_on_the_floor_laughing'] },
  { emoji: '😊', name: 'blush', category: 'Smileys', aliases: ['blush'] },
  { emoji: '😇', name: 'innocent', category: 'Smileys', aliases: ['innocent'] },
  { emoji: '🙂', name: 'slightly smiling', category: 'Smileys', aliases: ['slightly_smiling_face'] },
  { emoji: '😉', name: 'wink', category: 'Smileys', aliases: ['wink'] },
  { emoji: '😍', name: 'heart eyes', category: 'Smileys', aliases: ['heart_eyes'] },
  { emoji: '🥰', name: 'smiling with hearts', category: 'Smileys', aliases: ['smiling_face_with_three_hearts'] },
  { emoji: '😘', name: 'kissing heart', category: 'Smileys', aliases: ['kissing_heart'] },
  { emoji: '😋', name: 'yum', category: 'Smileys', aliases: ['yum'] },
  { emoji: '😎', name: 'sunglasses', category: 'Smileys', aliases: ['sunglasses', 'cool'] },
  { emoji: '🤩', name: 'star struck', category: 'Smileys', aliases: ['star_struck'] },
  { emoji: '🥳', name: 'partying', category: 'Smileys', aliases: ['partying_face'] },
  { emoji: '😏', name: 'smirk', category: 'Smileys', aliases: ['smirk'] },
  { emoji: '😒', name: 'unamused', category: 'Smileys', aliases: ['unamused'] },
  { emoji: '😔', name: 'pensive', category: 'Smileys', aliases: ['pensive'] },
  { emoji: '😢', name: 'cry', category: 'Smileys', aliases: ['cry'] },
  { emoji: '😭', name: 'sob', category: 'Smileys', aliases: ['sob'] },
  { emoji: '😤', name: 'triumph', category: 'Smileys', aliases: ['triumph'] },
  { emoji: '🤔', name: 'thinking', category: 'Smileys', aliases: ['thinking', 'thinking_face'] },
  { emoji: '🤗', name: 'hugging', category: 'Smileys', aliases: ['hugging_face'] },
  { emoji: '🤭', name: 'hand over mouth', category: 'Smileys', aliases: ['hand_over_mouth'] },
  { emoji: '🤫', name: 'shushing', category: 'Smileys', aliases: ['shushing_face'] },
  { emoji: '🤐', name: 'zipper mouth', category: 'Smileys', aliases: ['zipper_mouth_face'] },
  { emoji: '😴', name: 'sleeping', category: 'Smileys', aliases: ['sleeping'] },
  { emoji: '🤯', name: 'exploding head', category: 'Smileys', aliases: ['exploding_head', 'mind_blown'] },
  { emoji: '😱', name: 'scream', category: 'Smileys', aliases: ['scream'] },
  { emoji: '🥺', name: 'pleading', category: 'Smileys', aliases: ['pleading_face'] },
  { emoji: '😈', name: 'smiling imp', category: 'Smileys', aliases: ['smiling_imp'] },
  { emoji: '🤡', name: 'clown', category: 'Smileys', aliases: ['clown_face'] },
  { emoji: '💀', name: 'skull', category: 'Smileys', aliases: ['skull'] },
  { emoji: '👻', name: 'ghost', category: 'Smileys', aliases: ['ghost'] },
  { emoji: '🙄', name: 'eye roll', category: 'Smileys', aliases: ['roll_eyes'] },
  { emoji: '😬', name: 'grimacing', category: 'Smileys', aliases: ['grimacing'] },
  { emoji: '🫡', name: 'salute', category: 'Smileys', aliases: ['saluting_face', 'salute'] },

  // Gestures & Body (skin-tonable)
  { emoji: '👍', name: 'thumbs up', category: 'Gestures', aliases: ['+1', 'thumbsup', 'thumbs_up'], skinTonable: true },
  { emoji: '👎', name: 'thumbs down', category: 'Gestures', aliases: ['-1', 'thumbsdown', 'thumbs_down'], skinTonable: true },
  { emoji: '👏', name: 'clap', category: 'Gestures', aliases: ['clap'], skinTonable: true },
  { emoji: '🙌', name: 'raised hands', category: 'Gestures', aliases: ['raised_hands'], skinTonable: true },
  { emoji: '🤝', name: 'handshake', category: 'Gestures', aliases: ['handshake'], skinTonable: true },
  { emoji: '✊', name: 'fist', category: 'Gestures', aliases: ['fist', 'fist_raised'], skinTonable: true },
  { emoji: '👊', name: 'fist bump', category: 'Gestures', aliases: ['fist_oncoming', 'punch'], skinTonable: true },
  { emoji: '✌️', name: 'peace', category: 'Gestures', aliases: ['v', 'victory', 'peace'], skinTonable: true },
  { emoji: '🤞', name: 'crossed fingers', category: 'Gestures', aliases: ['crossed_fingers'], skinTonable: true },
  { emoji: '🤙', name: 'call me', category: 'Gestures', aliases: ['call_me_hand'], skinTonable: true },
  { emoji: '👋', name: 'wave', category: 'Gestures', aliases: ['wave'], skinTonable: true },
  { emoji: '🖐️', name: 'raised hand', category: 'Gestures', aliases: ['raised_hand_with_fingers_splayed'], skinTonable: true },
  { emoji: '💪', name: 'muscle', category: 'Gestures', aliases: ['muscle', 'flex'], skinTonable: true },
  { emoji: '🙏', name: 'pray', category: 'Gestures', aliases: ['pray', 'thanks'], skinTonable: true },
  { emoji: '🫶', name: 'heart hands', category: 'Gestures', aliases: ['heart_hands'], skinTonable: true },
  { emoji: '👀', name: 'eyes', category: 'Gestures', aliases: ['eyes'] },
  { emoji: '🧠', name: 'brain', category: 'Gestures', aliases: ['brain'] },
  { emoji: '🫠', name: 'melting', category: 'Gestures', aliases: ['melting_face'] },

  // Hearts & Symbols
  { emoji: '❤️', name: 'red heart', category: 'Hearts', aliases: ['heart', 'red_heart'] },
  { emoji: '🧡', name: 'orange heart', category: 'Hearts', aliases: ['orange_heart'] },
  { emoji: '💛', name: 'yellow heart', category: 'Hearts', aliases: ['yellow_heart'] },
  { emoji: '💚', name: 'green heart', category: 'Hearts', aliases: ['green_heart'] },
  { emoji: '💙', name: 'blue heart', category: 'Hearts', aliases: ['blue_heart'] },
  { emoji: '💜', name: 'purple heart', category: 'Hearts', aliases: ['purple_heart'] },
  { emoji: '🖤', name: 'black heart', category: 'Hearts', aliases: ['black_heart'] },
  { emoji: '🤍', name: 'white heart', category: 'Hearts', aliases: ['white_heart'] },
  { emoji: '💔', name: 'broken heart', category: 'Hearts', aliases: ['broken_heart'] },
  { emoji: '💯', name: 'hundred', category: 'Hearts', aliases: ['100', 'hundred'] },
  { emoji: '💥', name: 'boom', category: 'Hearts', aliases: ['boom', 'collision'] },
  { emoji: '⭐', name: 'star', category: 'Hearts', aliases: ['star'] },
  { emoji: '🌟', name: 'glowing star', category: 'Hearts', aliases: ['star2', 'glowing_star'] },
  { emoji: '✨', name: 'sparkles', category: 'Hearts', aliases: ['sparkles'] },
  { emoji: '🔥', name: 'fire', category: 'Hearts', aliases: ['fire', 'lit'] },
  { emoji: '💡', name: 'light bulb', category: 'Hearts', aliases: ['bulb', 'idea'] },

  // Objects & Work
  { emoji: '✅', name: 'check', category: 'Objects', aliases: ['white_check_mark', 'check'] },
  { emoji: '❌', name: 'cross mark', category: 'Objects', aliases: ['x', 'cross_mark'] },
  { emoji: '⚠️', name: 'warning', category: 'Objects', aliases: ['warning'] },
  { emoji: '🚀', name: 'rocket', category: 'Objects', aliases: ['rocket', 'ship_it'] },
  { emoji: '🎯', name: 'target', category: 'Objects', aliases: ['dart', 'target'] },
  { emoji: '🏆', name: 'trophy', category: 'Objects', aliases: ['trophy'] },
  { emoji: '🎉', name: 'party', category: 'Objects', aliases: ['tada', 'party'] },
  { emoji: '🎊', name: 'confetti', category: 'Objects', aliases: ['confetti_ball'] },
  { emoji: '📎', name: 'paperclip', category: 'Objects', aliases: ['paperclip'] },
  { emoji: '📌', name: 'pushpin', category: 'Objects', aliases: ['pushpin'] },
  { emoji: '📋', name: 'clipboard', category: 'Objects', aliases: ['clipboard'] },
  { emoji: '📝', name: 'memo', category: 'Objects', aliases: ['memo', 'pencil'] },
  { emoji: '📅', name: 'calendar', category: 'Objects', aliases: ['calendar', 'date'] },
  { emoji: '📊', name: 'bar chart', category: 'Objects', aliases: ['bar_chart'] },
  { emoji: '💻', name: 'laptop', category: 'Objects', aliases: ['computer', 'laptop'] },
  { emoji: '🖥️', name: 'desktop', category: 'Objects', aliases: ['desktop_computer'] },
  { emoji: '⚙️', name: 'gear', category: 'Objects', aliases: ['gear', 'settings'] },
  { emoji: '🔧', name: 'wrench', category: 'Objects', aliases: ['wrench'] },
  { emoji: '🔒', name: 'lock', category: 'Objects', aliases: ['lock'] },
  { emoji: '🔑', name: 'key', category: 'Objects', aliases: ['key'] },
  { emoji: '📣', name: 'megaphone', category: 'Objects', aliases: ['mega', 'megaphone'] },
  { emoji: '💬', name: 'speech bubble', category: 'Objects', aliases: ['speech_balloon'] },
  { emoji: '⏰', name: 'alarm clock', category: 'Objects', aliases: ['alarm_clock'] },
  { emoji: '☕', name: 'coffee', category: 'Objects', aliases: ['coffee'] },
  { emoji: '🍕', name: 'pizza', category: 'Objects', aliases: ['pizza'] },
  { emoji: '🍔', name: 'hamburger', category: 'Objects', aliases: ['hamburger', 'burger'] },
  { emoji: '🍻', name: 'clinking beers', category: 'Objects', aliases: ['beers'] },
  { emoji: '🎵', name: 'music notes', category: 'Objects', aliases: ['musical_note'] },
  { emoji: '🔴', name: 'red circle', category: 'Objects', aliases: ['red_circle'] },
  { emoji: '🟢', name: 'green circle', category: 'Objects', aliases: ['green_circle'] },
  { emoji: '🟡', name: 'yellow circle', category: 'Objects', aliases: ['yellow_circle'] },
  { emoji: '🔵', name: 'blue circle', category: 'Objects', aliases: ['blue_circle'] },

  // Nature
  { emoji: '🌈', name: 'rainbow', category: 'Nature', aliases: ['rainbow'] },
  { emoji: '☀️', name: 'sun', category: 'Nature', aliases: ['sunny', 'sun'] },
  { emoji: '🌙', name: 'moon', category: 'Nature', aliases: ['crescent_moon', 'moon'] },
  { emoji: '🌊', name: 'wave', category: 'Nature', aliases: ['ocean', 'wave'] },
  { emoji: '🌸', name: 'cherry blossom', category: 'Nature', aliases: ['cherry_blossom'] },
  { emoji: '🌻', name: 'sunflower', category: 'Nature', aliases: ['sunflower'] },
  { emoji: '🍀', name: 'four leaf clover', category: 'Nature', aliases: ['four_leaf_clover'] },
  { emoji: '🐶', name: 'dog', category: 'Nature', aliases: ['dog'] },
  { emoji: '🐱', name: 'cat', category: 'Nature', aliases: ['cat'] },
  { emoji: '🦊', name: 'fox', category: 'Nature', aliases: ['fox_face', 'fox'] },
  { emoji: '🐻', name: 'bear', category: 'Nature', aliases: ['bear'] },
  { emoji: '🦁', name: 'lion', category: 'Nature', aliases: ['lion'] },

  // Flags / Misc
  { emoji: '🏁', name: 'checkered flag', category: 'Flags', aliases: ['checkered_flag'] },
  { emoji: '🚩', name: 'red flag', category: 'Flags', aliases: ['triangular_flag_on_post'] },
  { emoji: '🏳️', name: 'white flag', category: 'Flags', aliases: ['white_flag'] },
  { emoji: '🇹🇭', name: 'thailand', category: 'Flags', aliases: ['th', 'thailand'] },
  { emoji: '🇺🇸', name: 'us', category: 'Flags', aliases: ['us', 'usa'] },
  { emoji: '🇯🇵', name: 'japan', category: 'Flags', aliases: ['jp', 'japan'] },
  { emoji: '🇬🇧', name: 'uk', category: 'Flags', aliases: ['gb', 'uk'] },
]

export const CATEGORIES = ['Smileys', 'Gestures', 'Hearts', 'Objects', 'Nature', 'Flags'] as const

export const CATEGORY_ICONS: Record<string, string> = {
  Smileys: '😀',
  Gestures: '👍',
  Hearts: '❤️',
  Objects: '🚀',
  Nature: '🌿',
  Flags: '🏁',
}

// ── Search matcher (name + colon alias) ──────────────────────────────────
/**
 * Returns true when the emoji matches `query`. Supports plain name search,
 * bare alias search ('thumbsup'), and colon-wrapped alias search (':+1:').
 */
export function emojiMatches(entry: EmojiEntry, query: string): boolean {
  const raw = query.trim().toLowerCase()
  if (!raw) return true
  // Strip surrounding colons so ':+1:' and '+1' behave identically.
  const q = raw.replace(/^:+/, '').replace(/:+$/, '')
  if (!q) return true
  if (entry.name.toLowerCase().includes(q)) return true
  if (entry.emoji.includes(q)) return true
  return (entry.aliases || []).some(a => a.toLowerCase().includes(q))
}

// ── Frequently-used emojis (stored in localStorage) ──────────────────────
const FREQ_KEY = 'aaelink-emoji-freq'
const MAX_RECENT = 16

export function getFrequent(): string[] {
  try {
    const raw = localStorage.getItem(FREQ_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch { return [] }
}

export function pushFrequent(emoji: string) {
  try {
    const cur = getFrequent().filter(e => e !== emoji)
    cur.unshift(emoji)
    localStorage.setItem(FREQ_KEY, JSON.stringify(cur.slice(0, MAX_RECENT)))
  } catch { /* noop */ }
}

// ── Skin-tone selection (stored in localStorage) ─────────────────────────
const TONE_KEY = 'aaelink:emoji:skintone'
// Legacy key read as a fallback so existing preferences migrate gracefully.
const TONE_KEY_LEGACY = 'aaelink-emoji-skin-tone'

/** Fitzpatrick modifier codepoints, indexed 0 (default/none) → 5 (darkest). */
export const SKIN_TONES = [
  { label: 'Default', modifier: '', swatch: '✋' },
  { label: 'Light', modifier: '\u{1F3FB}', swatch: '✋🏻' },
  { label: 'Medium-Light', modifier: '\u{1F3FC}', swatch: '✋🏼' },
  { label: 'Medium', modifier: '\u{1F3FD}', swatch: '✋🏽' },
  { label: 'Medium-Dark', modifier: '\u{1F3FE}', swatch: '✋🏾' },
  { label: 'Dark', modifier: '\u{1F3FF}', swatch: '✋🏿' },
] as const

export function getSkinTone(): number {
  try {
    const raw = localStorage.getItem(TONE_KEY) ?? localStorage.getItem(TONE_KEY_LEGACY)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 && n < SKIN_TONES.length ? n : 0
  } catch { return 0 }
}

export function setSkinTone(idx: number) {
  try {
    localStorage.setItem(TONE_KEY, String(idx))
  } catch { /* noop */ }
}

/**
 * Apply the chosen skin tone to a skin-tonable emoji. A variation selector
 * (U+FE0F) is dropped before appending the modifier so the combination renders
 * correctly. Non-tonable emoji and the default tone are returned unchanged.
 */
export function applySkinTone(entry: EmojiEntry, toneIdx: number): string {
  if (!entry.skinTonable || toneIdx <= 0) return entry.emoji
  const modifier = SKIN_TONES[toneIdx]?.modifier
  if (!modifier) return entry.emoji
  const base = entry.emoji.replace(/️/g, '')
  return base + modifier
}
