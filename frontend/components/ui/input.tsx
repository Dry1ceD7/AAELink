import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--muted)] outline-none transition-colors focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20 disabled:opacity-60',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--muted)] outline-none transition-colors focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-3 text-sm text-[color:var(--fg)] outline-none transition-colors focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-sm font-medium text-[color:var(--fg)]', className)}
      {...props}
    />
  )
}
