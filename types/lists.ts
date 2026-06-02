/**
 * List types for AAELink.
 *
 * Defines structured data tables (Slack Lists) with typed columns,
 * list items, and saved views.
 * Type-only — no runtime code.
 *
 * @module types/lists
 */

/** Supported column data types for list columns. */
export type ColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'person'
  | 'status'
  | 'select'
  | 'url'
  | 'email'
  | 'phone'
  | 'checkbox'

/** A structured data list attached to a channel. */
export interface List {
  /** Unique list identifier. */
  id: string
  /** Workspace this list belongs to. */
  workspace_id: string
  /** Channel this list is associated with (null if standalone). */
  channel_id: string | null
  /** List title. */
  title: string
  /** Description of the list's purpose. */
  description: string
  /** Column definitions for this list. */
  columns: ListColumn[]
  /** User ID of the list creator. */
  creator_id: string
  /** ISO-8601 creation timestamp. */
  created_at: string
  /** ISO-8601 last-updated timestamp. */
  updated_at: string
}

/** Column definition within a list. */
export interface ListColumn {
  /** Unique column identifier. */
  id: string
  /** Human-readable column name. */
  name: string
  /** Data type of this column. */
  type: ColumnType
  /** Whether a value is required for this column. */
  is_required: boolean
  /** Allowed values for select/status columns (null for other types). */
  options: string[] | null
  /** Display position within the list (0-based). */
  position: number
}

/** A single row/item in a list. */
export interface ListItem {
  /** Unique item identifier. */
  id: string
  /** List this item belongs to. */
  list_id: string
  /** Column values keyed by column ID. */
  values: Record<string, unknown>
  /** User ID assigned to this item (null if unassigned). */
  assignee_id: string | null
  /** Ordering position within the list. */
  position: number
  /** User ID who created this item. */
  created_by: string
  /** ISO-8601 creation timestamp. */
  created_at: string
  /** ISO-8601 last-updated timestamp. */
  updated_at: string
}

/** Saved view configuration for a list. */
export interface ListView {
  /** Unique view identifier. */
  id: string
  /** List this view is defined for. */
  list_id: string
  /** Human-readable view name. */
  name: string
  /** Active filter conditions for this view. */
  filters: Record<string, unknown>[]
  /** Column to sort by (null for default ordering). */
  sort_by: string | null
  /** Column to group rows by (null for flat view). */
  group_by: string | null
}
