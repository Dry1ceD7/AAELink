import type { CSSProperties } from 'react'

/**
 * `<Skeleton>` — Slack-style shimmer placeholder with token-driven motion.
 * Variants cover the high-frequency shapes (single line, short line, avatar
 * circle, content card). For unusual shapes, pass `style={{ width, height }}`.
 *
 * Respects `prefers-reduced-motion` via the `.ds-skeleton` CSS rule.
 */
export interface SkeletonProps {
  variant?: 'line' | 'line-short' | 'circle' | 'card'
  width?: number | string
  height?: number | string
  className?: string
  style?: CSSProperties
}

export function Skeleton({
  variant = 'line',
  width,
  height,
  className = '',
  style,
}: SkeletonProps) {
  const merged: CSSProperties = { ...style }
  if (width !== undefined) merged.width = width
  if (height !== undefined) merged.height = height
  return (
    <span
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={`ds-skeleton ds-skeleton--${variant} ${className}`}
      style={merged}
    />
  )
}

/**
 * `<SkeletonStack>` — convenience helper for "render N skeleton lines as a
 * column with consistent spacing". Common in list views.
 */
export function SkeletonStack({
  count = 3,
  variant = 'line',
  gap = 8,
}: {
  count?: number
  variant?: SkeletonProps['variant']
  gap?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant={variant} />
      ))}
    </div>
  )
}
