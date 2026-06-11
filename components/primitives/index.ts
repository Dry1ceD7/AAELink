/**
 * Design system primitives barrel.
 *
 * Import path: `@/components/primitives`
 *
 * Members:
 *   • Surface         — token-driven container (radius, border, padding, shadow)
 *   • Stack           — flex layout with token-driven gap
 *   • Modal           — backdrop + scale-and-fade entry, Esc + click-outside close
 *   • Tooltip         — CSS-only 200 ms hover label
 *   • Skeleton, SkeletonStack — Slack-style shimmer placeholders
 *   • EmptyState      — designed empty placeholder
 *   • ErrorState      — friendly error placeholder
 *   • Toggle          — accessible on/off switch
 *
 * The matching CSS lives at the bottom of `app/styles.css` under
 * "Design System Tokens (v0.0.44 Wave 1)".
 */
export { Surface, type SurfaceProps } from './Surface'
export { Stack, type StackProps } from './Stack'
export { Modal, type ModalProps } from './Modal'
export { Tooltip, type TooltipProps } from './Tooltip'
export { Skeleton, SkeletonStack, type SkeletonProps } from './Skeleton'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { ErrorState, type ErrorStateProps } from './ErrorState'
export { Toggle, type ToggleProps } from './Toggle'
export { SearchFiltersChips, type SearchFiltersChipsProps } from './SearchFilters'
export { DataTable, type DataTableProps } from './DataTable'
