'use client'

import { X } from 'lucide-react'
import { formatFilterChip, removeFilterToken, type FilterKey, type SearchFilters } from '@/lib/messaging/searchFilters'

/**
 * `<SearchFiltersChips>` — visual chip strip for parsed search filters.
 *
 * Renders one removable pill per active filter. Click the X (or press
 * Enter / Space when focused) to remove a filter and emit the new query
 * via `onRemove(newQuery)`. The query rewrite is delegated to
 * `removeFilterToken` (tested in `tests/searchFiltersChip.test.ts`) so
 * this component stays declarative.
 *
 * Returns `null` when no filters are active so callers don't need to
 * guard with their own `if (...)` block.
 */
export interface SearchFiltersChipsProps {
  /** Parsed filters from `parseSearchFilters(query)`. */
  filters: SearchFilters
  /** The raw query string (used to rebuild after a chip is removed). */
  query: string
  /**
   * Called with the new query string after a chip is removed.
   * The parent typically calls `setQuery(newQuery)` and re-runs the search.
   */
  onRemove: (newQuery: string) => void
  className?: string
}

const KEYS: FilterKey[] = ['from', 'in', 'before', 'after', 'has']

export function SearchFiltersChips({
  filters,
  query,
  onRemove,
  className = '',
}: SearchFiltersChipsProps) {
  // Collect active filters in stable display order.
  const active = KEYS
    .filter(k => Boolean(filters[k]))
    .map(k => ({ key: k, value: filters[k]! }))

  if (active.length === 0) return null

  return (
    <div className={`ds-search-filters ${className}`.trim()} role="list" aria-label="Active search filters">
      {active.map(({ key, value }) => {
        const label = formatFilterChip(key, value)
        return (
          <span key={`${key}:${value}`} className="ds-search-filter-chip" role="listitem">
            <span className="ds-search-filter-chip-label">{label}</span>
            <button
              type="button"
              className="ds-search-filter-chip-remove"
              aria-label={`Remove filter ${label}`}
              onClick={() => onRemove(removeFilterToken(query, key))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        )
      })}
    </div>
  )
}
