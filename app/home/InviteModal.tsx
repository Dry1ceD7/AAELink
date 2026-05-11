'use client'

import { useState } from 'react'
import { X, Link2, Copy, Check } from 'lucide-react'

interface InviteModalProps {
  open: boolean
  workspaceName: string
  inviteUrl: string
  inviteBusy: boolean
  onClose: () => void
}

export function InviteModal({ open, workspaceName, inviteUrl, inviteBusy, onClose }: InviteModalProps) {
  const [copied, setCopied] = useState(false)

  if (!open) return null

  return (
    <>
      <div className="ws-menu-backdrop" onClick={onClose} />
      <div className="aae-auth-modal-overlay" onClick={onClose}>
        <div className="invite-modal" onClick={e => e.stopPropagation()}>
          <div className="invite-modal-header">
            <h3>Invite people to {workspaceName}</h3>
            <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="invite-modal-body">
            <p className="invite-modal-desc">
              Share this link with colleagues so they can join your workspace. The link expires in 7 days.
            </p>
            {inviteBusy ? (
              <div className="invite-modal-loading">
                <span className="module-loading">Generating invite link…</span>
              </div>
            ) : inviteUrl ? (
              <div className="invite-modal-link-wrap">
                <div className="invite-modal-link-box">
                  <Link2 size={15} style={{ flexShrink: 0, color: 'var(--mm-link)' }} />
                  <span className="invite-modal-link-text">{inviteUrl}</span>
                </div>
                <button type="button" className="slack-button invite-modal-copy-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteUrl)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2500)
                    } catch { /* fallback */ }
                  }}>
                  {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy link</>}
                </button>
              </div>
            ) : (
              <p style={{ color: 'var(--mm-muted)', fontSize: 13 }}>Could not generate invite link. You may not have permission.</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
