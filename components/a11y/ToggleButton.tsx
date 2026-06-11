'use client'

import { type ButtonHTMLAttributes, forwardRef } from 'react'

export interface ToggleButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  pressed: boolean
  onPressedChange?: (pressed: boolean) => void
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(
  function ToggleButton(
    { pressed, onPressedChange, onClick, children, type = 'button', ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={pressed}
        onClick={e => {
          onPressedChange?.(!pressed)
          onClick?.(e)
        }}
        {...rest}
      >
        {children}
      </button>
    )
  }
)
