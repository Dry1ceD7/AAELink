'use client'

import { X, GripVertical, Star, Hash, MessageSquare, Package, Users, ShieldAlert } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'

const SIDEBAR_ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  star: Star, hash: Hash, message_square: MessageSquare, package: Package, users: Users, shield: ShieldAlert
}

export interface SidebarSectionConfig {
  key: string
  label: string
  iconKey: string
  enabled: boolean
}

interface SidebarCustomizerProps {
  open: boolean
  sections: SidebarSectionConfig[]
  onSectionsChange: Dispatch<SetStateAction<SidebarSectionConfig[]>>
  onClose: () => void
}

export function SidebarCustomizer({ open, sections, onSectionsChange, onClose }: SidebarCustomizerProps) {
  if (!open) return null

  return (
    <>
      <div className="sidebar-customizer-overlay" onClick={onClose} />
      <div className="sidebar-customizer" role="dialog" aria-modal="true" aria-label="Customize sidebar">
        <div className="sidebar-customizer-header">
          <h3>Customize your sidebar</h3>
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-customizer-body">
          <p style={{ padding: '0 18px 8px', margin: 0, fontSize: 12, color: 'var(--mm-muted)' }}>
            Toggle sections to show or hide them in your sidebar.
          </p>
          {sections.map((section, idx) => {
            const Icon = SIDEBAR_ICON_MAP[section.iconKey]
            return (
              <div key={section.key} className="sidebar-customizer-item">
                <GripVertical size={16} className="grip-icon" />
                <span style={{ fontSize: 16, width: 22, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {Icon ? <Icon size={16} /> : null}
                </span>
                <span className="item-label">{section.label}</span>
                <button
                  type="button"
                  className={`item-toggle${section.enabled ? ' active' : ''}`}
                  aria-label={`Toggle ${section.label}`}
                  onClick={() => {
                    onSectionsChange(prev => {
                      const next = [...prev]
                      next[idx] = { ...next[idx], enabled: !next[idx].enabled }
                      try { localStorage.setItem('aaelink_sidebar_sections', JSON.stringify(next)) } catch {}
                      return next
                    })
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
