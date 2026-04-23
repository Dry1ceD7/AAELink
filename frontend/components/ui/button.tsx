import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-[color:var(--accent)] text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[color:var(--color-brand-sky)]',
  secondary:
    'bg-[color:var(--surface)] text-[color:var(--fg)] border border-[color:var(--border)] hover:bg-[color:var(--color-brand-cloud)] dark:hover:bg-[color:var(--border)]',
  ghost:
    'bg-transparent text-[color:var(--fg)] hover:bg-[color:var(--surface)]',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  outline:
    'border border-[color:var(--border)] bg-transparent text-[color:var(--fg)] hover:bg-[color:var(--surface)]',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
  icon: 'h-9 w-9 p-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors outline-none disabled:opacity-50 disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
        )}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
