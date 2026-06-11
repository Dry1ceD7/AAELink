/**
 * Canvas types for AAELink.
 *
 * Defines collaborative canvas documents, sections, and access control.
 * Type-only — no runtime code.
 *
 * @module types/canvas
 */

/** Supported canvas section content types. */
export type CanvasSectionType =
  | 'markdown'
  | 'table'
  | 'checklist'
  | 'image'
  | 'divider'
  | 'code_block'
  | 'heading'

/** Access level for canvas collaboration. */
export type CanvasAccessLevel =
  | 'owner'
  | 'editor'
  | 'commenter'
  | 'viewer'

/** A collaborative canvas document attached to a channel. */
export interface Canvas {
  /** Unique canvas identifier. */
  id: string
  /** Workspace this canvas belongs to. */
  workspace_id: string
  /** Channel this canvas is associated with (null if standalone). */
  channel_id: string | null
  /** Canvas title. */
  title: string
  /** Whether the canvas has no content sections. */
  is_empty: boolean
  /** User ID of the canvas creator. */
  creator_id: string
  /** ISO-8601 creation timestamp. */
  created_at: string
  /** ISO-8601 last-updated timestamp. */
  updated_at: string
}

/** A content section within a canvas. */
export interface CanvasSection {
  /** Unique section identifier. */
  id: string
  /** Canvas this section belongs to. */
  canvas_id: string
  /** Type of content in this section. */
  section_type: CanvasSectionType
  /** Section content (format varies by section_type). */
  content: unknown
  /** Ordering position within the canvas (0-based). */
  position: number
  /** ISO-8601 creation timestamp. */
  created_at: string
}

/** Access control entry for a canvas. */
export interface CanvasAccess {
  /** Canvas identifier. */
  canvas_id: string
  /** User granted access. */
  user_id: string
  /** Level of access granted. */
  access_level: CanvasAccessLevel
}
