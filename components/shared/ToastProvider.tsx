'use client'

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { subscribeToasts, type ToastItem, type ToastVariant } from '@/lib/ui/toast'

const AUTO_DISMISS_MS = 4000

const VARIANT_COLOR: Record<ToastVariant, string> = {
  error: '#e01e5a',
  success: '#2bac76',
  info: '#1264a3',
}

export function ToastProvider() {
  const [items, setItems] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    return subscribeToasts(item => {
      setItems(prev => [...prev, item])
      setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS)
    })
  }, [dismiss])

  // Guard SSR / pre-hydration: createPortal + document.body must only run on the
  // client. `mounted` covers the React lifecycle; the document check is a belt-
  // and-braces guard so document.body is never touched on the server.
  if (!mounted || items.length === 0 || typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 10001,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 'min(360px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      {items.map(item => (
        <div
          key={item.id}
          role="status"
          aria-live="polite"
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 'var(--mm-radius-ui)',
            background: 'var(--mm-channel-bg)',
            color: 'var(--mm-text)',
            boxShadow: 'var(--mm-shadow-popover)',
            borderLeft: `4px solid ${VARIANT_COLOR[item.variant]}`,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{item.message}</span>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label="Dismiss notification"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--mm-muted)',
              cursor: 'pointer',
              padding: 2,
              marginTop: 1,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
