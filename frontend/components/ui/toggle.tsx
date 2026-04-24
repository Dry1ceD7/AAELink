'use client'

import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

// Slack-style switch. Tap target is the entire row so labels remain
// clickable (better accessibility than just the dot).
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex w-full items-center justify-between gap-4 rounded-md',
        'px-3 py-2.5 text-left transition-colors',
        'hover:bg-[color:var(--border)]/30 disabled:opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[color:var(--fg)]">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-[color:var(--muted)]">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked
            ? 'bg-[color:var(--accent)]'
            : 'bg-[color:var(--border)]',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}
