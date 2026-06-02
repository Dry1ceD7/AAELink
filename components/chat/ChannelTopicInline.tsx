'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface Props {
  channelId: string
  topic: string
  onSaved: (newTopic: string) => void
}

/**
 * Inline, click-to-edit channel topic that sits next to the channel title
 * in the header bar. Shows a pencil icon on hover; clicking opens a compact
 * input field. Enter saves, Escape cancels.
 */
export function ChannelTopicInline({ channelId, topic, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(topic)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(topic)
  }, [topic])

  useEffect(() => {
    if (editing) {
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [editing])

  const save = useCallback(async () => {
    const trimmed = value.trim()
    if (trimmed === topic.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    const res = await apiFetch('/api/channels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, purpose: trimmed })
    })
    setSaving(false)
    if (res.ok) {
      onSaved(trimmed)
      setEditing(false)
    }
  }, [channelId, value, topic, onSaved])

  const cancel = useCallback(() => {
    setValue(topic)
    setEditing(false)
  }, [topic])

  if (editing) {
    return (
      <div className="channel-topic-edit">
        <input
          ref={inputRef}
          className="channel-topic-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void save() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          placeholder="Add a topic"
          maxLength={500}
          disabled={saving}
        />
        <button
          type="button"
          className="channel-topic-btn channel-topic-btn--save"
          onClick={() => void save()}
          disabled={saving}
          aria-label="Save topic"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          className="channel-topic-btn channel-topic-btn--cancel"
          onClick={cancel}
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="channel-topic-display"
      onClick={() => setEditing(true)}
      title={topic || 'Add a topic'}
    >
      <span className="channel-topic-text">
        {topic || <span className="channel-topic-placeholder">Add a topic</span>}
      </span>
      <Pencil size={12} className="channel-topic-pencil" />
    </button>
  )
}
