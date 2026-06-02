'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'

interface CustomStatusPopupProps {
  open: boolean
  onClose: () => void
}

const PRESETS = [
  { emoji: '📅', text: 'In a meeting' },
  { emoji: '🚌', text: 'Commuting' },
  { emoji: '🤒', text: 'Out sick' },
  { emoji: '🌴', text: 'Vacationing' },
  { emoji: '🏠', text: 'Working remotely' },
  { emoji: '🔇', text: 'Focusing' },
] as const

const EMOJI_CYCLE = ['😊', '🏠', '🌴', '🤒', '🚀', '📅', '🎯', '💬', '🔇', '⛔']

export function CustomStatusPopup({ open, onClose }: CustomStatusPopupProps) {
  const [emoji, setEmoji] = useState('')
  const [text, setText] = useState('')

  if (!open) return null

  return (
    <>
      <div className="ws-menu-backdrop" onClick={onClose} />
      <div className="aae-auth-modal-overlay" onClick={onClose}>
        <div className="custom-status-popup" style={{
          position: 'relative', bottom: 'auto', left: 'auto', right: 'auto',
          maxWidth: 420, width: '100%', margin: '0 auto'
        }} onClick={e => e.stopPropagation()}>
          <h4>Set a status</h4>
          <div className="custom-status-row">
            <button type="button" className="custom-status-emoji-btn"
              onClick={() => {
                const idx = EMOJI_CYCLE.indexOf(emoji)
                setEmoji(EMOJI_CYCLE[(idx + 1) % EMOJI_CYCLE.length])
              }}>
              {emoji || '😊'}
            </button>
            <input type="text" className="custom-status-input"
              placeholder="What's your status?"
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={64}
              autoFocus />
          </div>
          <div className="custom-status-presets">
            {PRESETS.map(p => (
              <button key={p.text} type="button" className="custom-status-preset"
                onClick={() => { setEmoji(p.emoji); setText(p.text) }}>
                <span>{p.emoji}</span> {p.text}
              </button>
            ))}
          </div>
          <div className="custom-status-actions">
            <button type="button" className="ghost-button" style={{ fontSize: 13 }}
              onClick={async () => {
                setEmoji(''); setText('')
                await apiFetch('/api/auth/me', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status_emoji: '', status_text: '' })
                })
                onClose()
              }}>
              Clear status
            </button>
            <button type="button" className="slack-button" style={{ fontSize: 13 }}
              onClick={async () => {
                await apiFetch('/api/auth/me', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    status_emoji: emoji || '😊',
                    status_text: text
                  })
                })
                onClose()
              }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
