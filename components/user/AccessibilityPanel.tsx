'use client'

import { useState } from 'react'
import { Accessibility, X } from 'lucide-react'

/* ── Accessibility Settings — a11y preferences panel ─────────────── */

export default function AccessibilityPanel({ onClose }: { onClose: () => void }) {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [largeText, setLargeText] = useState(false)
  const [screenReader, setScreenReader] = useState(false)
  const [keyboardNav, setKeyboardNav] = useState(true)
  const [focusIndicators, setFocusIndicators] = useState(true)
  const [linkUnderlines, setLinkUnderlines] = useState(false)
  const [emojiSkinTone, setEmojiSkinTone] = useState('default')
  const [messageSpacing, setMessageSpacing] = useState<'compact' | 'normal' | 'relaxed'>('normal')
  const [fontSize, setFontSize] = useState(14)

  const Toggle = ({ value, onChange, label, description }: { value: boolean; onChange: (v: boolean) => void; label: string; description: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--mm-border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{description}</div>
      </div>
      <button onClick={() => onChange(!value)} style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
        background: value ? '#2bac76' : '#ccc', transition: 'background 200ms', flexShrink: 0,
      }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: value ? 22 : 2, transition: 'left 200ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
      </button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #2bac76, #059669)', display: 'grid', placeItems: 'center' }}><Accessibility size={18} color="#fff" /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Accessibility</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Customize your experience for comfort & usability</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
        {/* Visual */}
        <h3 style={{ fontSize: 13, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 8px' }}>Visual</h3>
        <Toggle value={highContrast} onChange={setHighContrast} label="High Contrast Mode" description="Increase contrast for better readability" />
        <Toggle value={reducedMotion} onChange={setReducedMotion} label="Reduce Motion" description="Minimize animations and transitions" />
        <Toggle value={largeText} onChange={setLargeText} label="Large Text" description="Increase default text size across the app" />
        <Toggle value={linkUnderlines} onChange={setLinkUnderlines} label="Underline Links" description="Always underline links for easier identification" />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--mm-border)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Font Size</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Adjust the base font size</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setFontSize(Math.max(10, fontSize - 1))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--mm-border)', background: 'var(--mm-hover-bg)', cursor: 'pointer', fontSize: 14, color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}>−</button>
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{fontSize}</span>
            <button onClick={() => setFontSize(Math.min(22, fontSize + 1))} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--mm-border)', background: 'var(--mm-hover-bg)', cursor: 'pointer', fontSize: 14, color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}>+</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--mm-border)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Message Spacing</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Space between messages</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['compact', 'normal', 'relaxed'] as const).map(s => (
              <button key={s} onClick={() => setMessageSpacing(s)} style={{
                padding: '4px 10px', borderRadius: 6, border: 'none', fontSize: 11, cursor: 'pointer',
                fontWeight: messageSpacing === s ? 700 : 500,
                background: messageSpacing === s ? '#2bac76' : 'var(--mm-hover-bg)',
                color: messageSpacing === s ? '#fff' : 'var(--mm-text)',
              }}>{s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <h3 style={{ fontSize: 13, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 8px' }}>Navigation</h3>
        <Toggle value={keyboardNav} onChange={setKeyboardNav} label="Keyboard Navigation" description="Navigate with Tab, Arrow keys, and shortcuts" />
        <Toggle value={focusIndicators} onChange={setFocusIndicators} label="Focus Indicators" description="Show visible outline on focused elements" />

        {/* Screen Reader */}
        <h3 style={{ fontSize: 13, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 8px' }}>Assistive Technology</h3>
        <Toggle value={screenReader} onChange={setScreenReader} label="Screen Reader Optimized" description="Optimize layout for VoiceOver / NVDA / JAWS" />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--mm-border)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Emoji Skin Tone</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>Default skin tone for emoji</div>
          </div>
          <select value={emojiSkinTone} onChange={e => setEmojiSkinTone(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
            <option value="default">Default</option>
            <option value="light">Light</option>
            <option value="medium-light">Medium-Light</option>
            <option value="medium">Medium</option>
            <option value="medium-dark">Medium-Dark</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        {/* Keyboard shortcuts info */}
        <h3 style={{ fontSize: 13, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 8px' }}>Keyboard Shortcuts</h3>
        <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)' }}>
          {[
            { keys: '⌘ + K', desc: 'Quick Switcher' },
            { keys: '⌘ + /', desc: 'Keyboard Shortcuts' },
            { keys: '⌘ + Shift + A', desc: 'All Unread' },
            { keys: '⌘ + Shift + T', desc: 'All Threads' },
            { keys: '⌘ + Shift + D', desc: 'All Drafts' },
            { keys: '⌘ + F', desc: 'Search' },
            { keys: 'Esc', desc: 'Close Panel / Modal' },
          ].map(s => (
            <div key={s.keys} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--mm-border)' }}>
              <span style={{ fontSize: 13, opacity: 0.7 }}>{s.desc}</span>
              <code style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, background: 'var(--mm-hover-bg)', fontFamily: 'monospace' }}>{s.keys}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
