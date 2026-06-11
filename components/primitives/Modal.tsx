'use client'

import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useFocusTrap } from '../a11y/useFocusTrap'

/**
 * `<Modal>` — centered backdrop + scale-and-fade entry. Click outside or Esc
 * to dismiss (controlled via `onClose`). Backdrop and content z-indexes are
 * driven by the `--z-modal-backdrop` / `--z-modal` tokens.
 *
 * Replaces ad-hoc `position: fixed; inset: 0; …` JSX patterns littered across
 * the codebase. Locks body scroll on open so background doesn't shift.
 *
 * Focus is trapped within the dialog while open (via `useFocusTrap`) and
 * restored to the previously-focused element on close.
 */
export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'full'
  /** When true, clicking outside the modal does NOT close it. */
  noBackdropClose?: boolean
  className?: string
  /** ARIA label for screen readers when no `title` is provided. */
  ariaLabel?: string
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  noBackdropClose = false,
  className = '',
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while open (`overflow: hidden` only — does not jump the
  // page when the scrollbar disappears because we leave a gutter via padding
  // — but for a simpler implementation we just toggle `overflow`).
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Trap keyboard focus inside the dialog while open; restore on close.
  useFocusTrap(dialogRef, open)

  if (!open) return null

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (noBackdropClose) return
    if (e.target === e.currentTarget) onClose()
  }

  const sizeClass = size === 'lg' ? ' ds-modal--lg' : size === 'full' ? ' ds-modal--full' : ''

  return (
    <div className="ds-modal-backdrop" onClick={handleBackdrop} role="presentation">
      <div
        ref={dialogRef}
        className={`ds-modal${sizeClass} ${className}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-labelledby={title ? 'ds-modal-title' : undefined}
      >
        {title && (
          <header className="ds-modal-header">
            <h2 className="ds-modal-title" id="ds-modal-title">{title}</h2>
            <button
              type="button"
              className="mm-icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
        )}
        <div className="ds-modal-body">{children}</div>
        {footer && <footer className="ds-modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}
