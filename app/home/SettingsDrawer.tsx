'use client'

import { X } from 'lucide-react'
import { SettingsShell } from '@/app/components/SettingsShell'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  if (!open) return null

  return (
    <>
      <div className="settings-drawer-backdrop" onClick={onClose} />
      <div className="settings-drawer" role="dialog" aria-modal="true" aria-label="Settings"
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
        <div className="settings-drawer-header">
          <h2>Preferences</h2>
          <button type="button" className="settings-drawer-close"
            onClick={onClose} aria-label="Close settings">
            <X size={20} />
          </button>
        </div>
        <div className="settings-drawer-body">
          <SettingsShell variant="drawer" onClose={onClose} />
        </div>
      </div>
    </>
  )
}
