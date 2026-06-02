import type { ReactNode } from 'react'

/**
 * `<EmptyState>` — designed empty placeholder. Replaces ad-hoc
 * `<div>No data</div>` patterns scattered across panels.
 *
 * Slack-style: large muted icon, short title, helper description, optional CTA.
 */
export interface EmptyStateProps {
  /** Lucide icon node, e.g. `<Inbox size={40} />`. */
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`ds-empty-state ${className}`} role="status">
      {icon && <div className="ds-empty-state-icon" aria-hidden="true">{icon}</div>}
      <h3 className="ds-empty-state-title">{title}</h3>
      {description && <p className="ds-empty-state-description">{description}</p>}
      {action && <div className="ds-empty-state-action">{action}</div>}
    </div>
  )
}
