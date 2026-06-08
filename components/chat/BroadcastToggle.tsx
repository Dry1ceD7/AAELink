'use client'

import { useId } from 'react'

interface BroadcastToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  channelName: string
}

/**
 * `<BroadcastToggle>` — a labeled checkbox used in thread composers to also
 * send a thread reply back to the parent channel. Slack/Mattermost call this
 * "also send to channel". Controlled via `checked` / `onChange`.
 */
export function BroadcastToggle({ checked, onChange, channelName }: BroadcastToggleProps) {
  const id = useId()
  return (
    <label htmlFor={id} className="broadcast-toggle">
      <input
        id={id}
        type="checkbox"
        className="broadcast-toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="broadcast-toggle-label">Also send to #{channelName}</span>
    </label>
  )
}
