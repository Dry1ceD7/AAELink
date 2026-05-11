'use client'

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  'aria-label': string
  icon: ReactNode
  label?: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ icon, label, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} {...rest}>
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          {icon}
        </span>
        {label}
      </button>
    )
  }
)
