import type { CSSProperties, ReactNode } from 'react'

/**
 * `<Stack>` — vertical / horizontal flex layout with token-driven gap.
 * Replaces the dozen variants of `<div style={{ display: 'flex', gap: N }}>`
 * scattered through the codebase.
 */
export interface StackProps {
  direction?: 'col' | 'row'
  gap?: 2 | 3 | 4 | 5 | 6 | 8
  align?: 'start' | 'center' | 'end'
  justify?: 'start' | 'between' | 'center'
  wrap?: boolean
  full?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
  as?: 'div' | 'section' | 'header' | 'footer' | 'nav'
}

export function Stack({
  direction = 'col',
  gap,
  align,
  justify,
  wrap,
  full,
  className = '',
  style,
  children,
  as: Tag = 'div',
}: StackProps) {
  const classes = [
    'ds-stack',
    direction === 'row' ? 'ds-stack--row' : '',
    gap ? `ds-stack--gap-${gap}` : '',
    align ? `ds-stack--align-${align}` : '',
    justify === 'between' ? 'ds-stack--justify-between' :
      justify === 'center' ? 'ds-stack--justify-center' : '',
    wrap ? 'ds-stack--wrap' : '',
    full ? 'ds-stack--full' : '',
    className,
  ].filter(Boolean).join(' ')
  return <Tag className={classes} style={style}>{children}</Tag>
}
