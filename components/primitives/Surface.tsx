import type { CSSProperties, ReactNode } from 'react'

/**
 * `<Surface>` — opinionated container with the project's design tokens
 * (radius, border, padding, shadow). Replaces ad-hoc inline `style` blocks
 * for cards / panels / popover bodies.
 *
 * Pure CSS-class composition; no runtime cost vs an inline `style` object.
 */
export interface SurfaceProps {
  bordered?: boolean
  elevated?: 0 | 1 | 2 | 3
  padded?: 'sm' | 'md' | 'lg' | false
  className?: string
  style?: CSSProperties
  children?: ReactNode
  as?: 'div' | 'section' | 'article'
}

export function Surface({
  bordered = false,
  elevated = 0,
  padded = false,
  className = '',
  style,
  children,
  as: Tag = 'div',
}: SurfaceProps) {
  const classes = [
    'ds-surface',
    bordered ? 'ds-surface--bordered' : '',
    elevated > 0 ? `ds-surface--elevated-${elevated}` : '',
    padded ? `ds-surface--padded-${padded}` : '',
    className,
  ].filter(Boolean).join(' ')
  return <Tag className={classes} style={style}>{children}</Tag>
}
