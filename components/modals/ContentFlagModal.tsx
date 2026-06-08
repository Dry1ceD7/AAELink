'use client'

import { useEffect, useState } from 'react'
import { Ban, AlertOctagon, Lock, Mail, ShieldAlert, Copyright, ClipboardList, HelpCircle, Flag, CheckCircle, X } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   ContentFlagModal — Message reporting for admin review
   • Users flag messages for policy violations
   • Category selection + optional description
   • Tracks flag history
   ───────────────────────────────────────────────────────────────────── */

interface ContentFlagModalProps {
  messageId: string
  messagePreview: string
  senderName: string
  onClose: () => void
  onSubmit: (flag: { category: string; description: string }) => void
}

const FLAG_CATEGORIES = [
  { id: 'harassment', label: 'Harassment or bullying', iconKey: 'ban', description: 'Intimidating, threatening, or abusive behavior' },
  { id: 'discrimination', label: 'Discrimination', iconKey: 'alert', description: 'Content targeting protected characteristics' },
  { id: 'confidential', label: 'Confidential information', iconKey: 'lock', description: 'Shared passwords, credentials, or sensitive data' },
  { id: 'spam', label: 'Spam or phishing', iconKey: 'mail', description: 'Unsolicited promotional content or scam attempts' },
  { id: 'inappropriate', label: 'Inappropriate content', iconKey: 'shield', description: 'NSFW, violent, or offensive material' },
  { id: 'ip_violation', label: 'Intellectual property', iconKey: 'copyright', description: 'Unauthorized use of copyrighted or trademarked material' },
  { id: 'policy', label: 'Policy violation', iconKey: 'clipboard', description: 'Violates company code of conduct or acceptable use policy' },
  { id: 'other', label: 'Other concern', iconKey: 'help', description: 'Doesn\'t fit another category' },
]

const FLAG_ICON_MAP: Record<string, React.ComponentType<{ size: number }>> = {
  ban: Ban, alert: AlertOctagon, lock: Lock, mail: Mail, shield: ShieldAlert,
  copyright: Copyright, clipboard: ClipboardList, help: HelpCircle,
}

export default function ContentFlagModal({ messageId, messagePreview, senderName, onClose, onSubmit }: ContentFlagModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSubmit = () => {
    if (!selectedCategory) return
    onSubmit({ category: selectedCategory, description })
    setIsSubmitted(true)
  }

  if (isSubmitted) {
    return (
      <div className="slack-modal-overlay" onClick={onClose} role="presentation">
        <div className="slack-modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="content-flag-modal-success-title" style={{
          padding: 32, textAlign: 'center', maxWidth: 420,
        }}>
          <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><CheckCircle size={48} color="#2bac76" /></span>
          <h3 id="content-flag-modal-success-title" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Report submitted</h3>
          <p style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.6, marginBottom: 20 }}>
            Your report has been sent to the workspace administrators for review.
            You'll be notified once a decision has been made.
          </p>
          <button onClick={onClose} style={{
            background: '#4361EE', border: 'none', borderRadius: 8,
            padding: '10px 32px', color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: 'pointer',
          }}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="slack-modal-overlay" onClick={onClose} role="presentation">
      <div className="slack-modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="content-flag-modal-title" style={{ padding: 0, maxWidth: 520 }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--mm-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Flag size={18} />
            <h3 id="content-flag-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Report this message</h3>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)',
          }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Message preview */}
          <div style={{
            background: 'var(--mm-hover-bg)', borderRadius: 10, padding: 14, marginBottom: 16,
            borderLeft: '3px solid var(--mm-border)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.6, marginBottom: 4 }}>{senderName}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.85 }}>{messagePreview}</div>
          </div>

          {/* Category selection */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
              Why are you reporting this message?
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {FLAG_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                  borderRadius: 10,
                  border: selectedCategory === cat.id ? '2px solid #4361EE' : '1px solid var(--mm-border)',
                  background: selectedCategory === cat.id ? 'rgba(67,97,238,0.04)' : 'none',
                  cursor: 'pointer', textAlign: 'left', color: 'var(--mm-text)',
                  transition: 'all 150ms ease',
                }}>
                  <span style={{ fontSize: 14, marginTop: 1, display: 'flex' }}>{(() => { const Icon = FLAG_ICON_MAP[cat.iconKey]; return Icon ? <Icon size={14} /> : null; })()}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{cat.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{cat.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Additional context */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Additional context <span style={{ fontWeight: 400, opacity: 0.5 }}>(optional)</span>
            </label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Provide any additional details that might help admins review this report…"
              style={{
                width: '100%', border: '1px solid var(--mm-border)', borderRadius: 8,
                padding: 12, fontSize: 13, lineHeight: 1.6, minHeight: 80,
                background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
              }} />
          </div>

          {/* Privacy note */}
          <div style={{
            fontSize: 11, opacity: 0.5, lineHeight: 1.5, marginBottom: 16,
            padding: '8px 12px', background: 'var(--mm-hover-bg)', borderRadius: 8,
          }}>
            <Lock size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> This report is confidential. Only workspace administrators will see your report.
            The message author will not be notified that you submitted a report.
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{
              border: '1px solid var(--mm-border)', borderRadius: 8,
              padding: '10px 20px', background: 'none', cursor: 'pointer',
              color: 'var(--mm-text)', fontSize: 13,
            }}>Cancel</button>
            <button onClick={handleSubmit} disabled={!selectedCategory} style={{
              background: !selectedCategory ? 'var(--mm-border)' : '#e01e5a',
              border: 'none', borderRadius: 8, padding: '10px 20px',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: !selectedCategory ? 0.5 : 1,
            }}>Submit Report</button>
          </div>
        </div>
      </div>
    </div>
  )
}
