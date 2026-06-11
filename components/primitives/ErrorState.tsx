import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * `<ErrorState>` — friendly error placeholder. Replaces toast-only or
 * `console.error`-and-blank-screen anti-patterns.
 *
 * Pairs with the central `lib/log.ts` — components that catch an error should
 * call `log.error(...)` then render `<ErrorState>` for the user.
 */
export interface ErrorStateProps {
  /** Optional icon override; defaults to AlertCircle. */
  icon?: ReactNode
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}

export function ErrorState({
  icon,
  title = 'Something went wrong',
  description,
  action,
  className = '',
}: ErrorStateProps) {
  return (
    <div className={`ds-error-state ${className}`} role="alert">
      <div className="ds-error-state-icon" aria-hidden="true">
        {icon ?? <AlertCircle size={32} strokeWidth={2} />}
      </div>
      <h3 className="ds-error-state-title">{title}</h3>
      {description && <p className="ds-error-state-description">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  )
}
