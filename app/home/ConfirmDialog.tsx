'use client'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, busy = false, onConfirm, onCancel
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={onCancel}>
      <div className="mm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="mm-editor-hint" style={{ marginTop: 8 }}>{message}</p>
        <div className="mm-modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className="slack-button"
            style={danger ? { background: '#D24B4E' } : undefined}
            disabled={busy}
            onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
