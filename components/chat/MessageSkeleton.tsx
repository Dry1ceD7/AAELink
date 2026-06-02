'use client'

import { memo } from 'react'

/**
 * MessageSkeleton — Animated shimmer skeleton for loading state.
 * Renders fake message rows that pulse while real messages load.
 */
export const MessageSkeleton = memo(function MessageSkeleton({ count = 5 }: { count?: number }) {
  const widths = ['long', 'medium', 'short', 'long', 'medium'] as const
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="message-skeleton" aria-hidden="true">
          <div className="message-skeleton-avatar" />
          <div className="message-skeleton-content">
            <div className="message-skeleton-line message-skeleton-line--name" />
            <div className={`message-skeleton-line message-skeleton-line--${widths[i % widths.length]}`} />
            {i % 2 === 0 && (
              <div className="message-skeleton-line message-skeleton-line--medium" />
            )}
          </div>
        </div>
      ))}
    </>
  )
})
