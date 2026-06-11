/**
 * Search types for AAELink.
 *
 * Defines search queries, filters, results, and facets
 * for the platform-wide search API.
 * Type-only — no runtime code.
 *
 * @module types/search
 */

/** Search filter type discriminator. */
export type SearchFilterType =
  | 'channel'
  | 'user'
  | 'date_range'
  | 'file_type'
  | 'has_reaction'
  | 'is_pinned'
  | 'is_starred'

/** Sortable fields for search results. */
export type SearchSortField =
  | 'timestamp'
  | 'relevance'

/** Sort direction. */
export type SearchSortOrder =
  | 'asc'
  | 'desc'

/** Hit type discriminator for search results. */
export type SearchHitType =
  | 'message'
  | 'file'

/** Full search query with filters, sorting, and pagination. */
export interface SearchQuery {
  /** Free-text search query string. */
  query: string
  /** Active search filters. */
  filters: SearchFilter[]
  /** Sort configuration. */
  sort: SearchSort
  /** Pagination parameters. */
  pagination: { offset: number; limit: number }
}

/** A single search filter constraint. */
export interface SearchFilter {
  /** Filter type. */
  type: SearchFilterType
  /** Filter value (type depends on the filter type). */
  value: unknown
}

/** Sort configuration for search results. */
export interface SearchSort {
  /** Field to sort by. */
  field: SearchSortField
  /** Sort direction. */
  order: SearchSortOrder
}

/** Paginated search result set. */
export interface SearchResult {
  /** Matching message hits. */
  messages: SearchHit[]
  /** Matching file hits. */
  files: SearchHit[]
  /** Total number of matches across all pages. */
  total_matches: number
  /** Pagination metadata. */
  pagination: { offset: number; limit: number; has_more: boolean }
}

/** A single search result hit with relevance scoring. */
export interface SearchHit {
  /** Hit type (message or file). */
  type: SearchHitType
  /** ID of the matched object. */
  object_id: string
  /** Channel the match was found in. */
  channel_id: string
  /** User who authored the matched content. */
  user_id: string
  /** Matched text content. */
  text: string
  /** Highlighted text fragments with matched terms. */
  highlights: string[]
  /** Relevance score (higher is more relevant). */
  score: number
  /** ISO-8601 timestamp of the matched object. */
  timestamp: string
}

/** Aggregation facet for search result refinement. */
export interface SearchFacet {
  /** Field this facet aggregates on. */
  field: string
  /** Facet value buckets with counts. */
  buckets: { key: string; count: number }[]
}
