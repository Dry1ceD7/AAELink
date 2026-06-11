'use client'

import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import type { ReadReceipt } from '@/lib/realtime/realtime'
import { type AppUser, displayName } from './ChatMessage'

const MAX_VISIBLE = 5
const AVATAR_PX = 18

/**
 * Mark a message as read the first time it scrolls into view. POSTs once per
 * mount (guarded), only when `enabled` (caller filters out self-authored,
 * pending, or already-read messages). Failures are swallowed and allow a retry.
 */
export function useMarkReadOnView(
  ref: RefObject<HTMLElement | null>,
  messageId: string,
  enabled: boolean
): void {
  const sentRef = useRef(false)
  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return
    if (typeof IntersectionObserver === 'undefined') return
    if (sentRef.current) return

    const sendRead = () => {
      if (sentRef.current) return
      sentRef.current = true
      void apiFetch(`/api/messages/${messageId}/read`, { method: 'POST' }).catch(() => {
        sentRef.current = false
      })
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            sendRead()
            observer.disconnect()
            break
          }
        }
      },
      { threshold: 0.6 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, messageId, enabled])
}

function readerLabel(receipt: ReadReceipt, userMap: Record<string, AppUser>): string {
  const u = userMap[receipt.user_id]
  return u ? displayName(u) : receipt.user_id.slice(0, 8)
}

function readerInitial(receipt: ReadReceipt, userMap: Record<string, AppUser>): string {
  const u = userMap[receipt.user_id]
  return (u?.username || readerLabel(receipt, userMap)).slice(0, 1).toUpperCase()
}

/**
 * Compact reader avatar stack shown beneath a message's reactions row. Renders up
 * to {@link MAX_VISIBLE} overlapping reader avatars with a hover tooltip listing
 * every reader by display name. Presence dots are intentionally omitted here to
 * keep the stack lightweight; this surface is read-receipts only.
 */
export function ReadReceipts({
  receipts,
  userMap
}: {
  receipts: ReadReceipt[]
  userMap: Record<string, AppUser>
}) {
  const [hovered, setHovered] = useState(false)
  const visible = useMemo(() => receipts.slice(0, MAX_VISIBLE), [receipts])
  const names = useMemo(
    () => receipts.map(r => readerLabel(r, userMap)),
    [receipts, userMap]
  )

  if (receipts.length === 0) return null

  const tooltipText =
    receipts.length === 1
      ? `Read by ${names[0]}`
      : `Read by ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  return (
    <div
      className="message-read-receipts"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        marginTop: 2
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      role="group"
      aria-label={tooltipText}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden="true">
        {visible.map((r, i) => {
          const u = userMap[r.user_id]
          return (
            <span
              key={r.user_id}
              className="message-read-receipt-avatar"
              title={readerLabel(r, userMap)}
              style={{
                width: AVATAR_PX,
                height: AVATAR_PX,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 600,
                color: u?.avatar_url ? 'transparent' : 'var(--text-primary, #1d1c1d)',
                background: u?.avatar_url ? undefined : 'var(--avatar-bg, #cbd2d9)',
                backgroundImage: u?.avatar_url ? `url(${u.avatar_url})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: '1.5px solid var(--surface, #fff)',
                marginLeft: i === 0 ? 0 : -6,
                boxSizing: 'border-box'
              }}
            >
              {u?.avatar_url ? '' : readerInitial(r, userMap)}
            </span>
          )
        })}
      </span>
      {receipts.length > MAX_VISIBLE ? (
        <span
          className="message-read-receipt-overflow"
          style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted, #616061)' }}
          aria-hidden="true"
        >
          +{receipts.length - MAX_VISIBLE}
        </span>
      ) : null}
      {hovered ? (
        <span
          role="tooltip"
          className="message-read-receipt-tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            whiteSpace: 'nowrap',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.3,
            color: 'var(--tooltip-text, #fff)',
            background: 'var(--tooltip-bg, #1d1c1d)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            pointerEvents: 'none'
          }}
        >
          {tooltipText}
        </span>
      ) : null}
    </div>
  )
}
