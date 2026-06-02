/**
 * Common API types for AAELink.
 *
 * Defines the standard response envelope, pagination, errors,
 * sort ordering, and date range filters.
 * Type-only — no runtime code.
 *
 * @module types/api
 */

/** Standard API response envelope. */
export interface ApiResponse<T> {
  /** Whether the request succeeded. */
  ok: boolean
  /** Response payload (present on success). */
  data?: T
  /** Error message (present on failure). */
  error?: string
  /** Pagination metadata (present on list responses). */
  metadata?: PaginationMeta
}

/** Pagination metadata for list endpoints. */
export interface PaginationMeta {
  /** Total number of results matching the query. */
  total: number
  /** Current page number (1-based). */
  page: number
  /** Number of results per page. */
  per_page: number
  /** Whether more results exist beyond the current page. */
  has_more: boolean
  /** Cursor for the next page (null if no more pages). */
  next_cursor: string | null
}

/** Structured API error detail. */
export interface ApiError {
  /** Machine-readable error code (e.g. "INVALID_INPUT"). */
  code: string
  /** Human-readable error message. */
  message: string
  /** Additional error context. */
  details?: Record<string, unknown>
}

/** Sort order direction. */
export type SortOrder =
  | 'asc'
  | 'desc'

/** Date range filter for query parameters. */
export interface DateRange {
  /** ISO-8601 start date (inclusive). */
  from: string
  /** ISO-8601 end date (inclusive). */
  to: string
}
