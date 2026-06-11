/**
 * Canvas access engine — the single source of truth for who may read/write a
 * canvas. Replaces the inline, partially-unenforced checks that used to live in
 * app/api/docs/canvas/route.ts (and the inert canvas_access table).
 *
 * Access model (Slack Canvas parity):
 *   READ  — granted to:
 *     • the creator (always);
 *     • any member of the canvas's channel when type='channel_canvas'
 *       (via userCanReadChannel — fixes the private-channel leak);
 *     • a member of the canvas's WORKSPACE when type='template' (starter docs).
 *       Templates are workspace-scoped, NOT global: a template authored in
 *       workspace A is readable only to members of workspace A (a canvas whose
 *       workspace_id is empty/unknown is NOT treated as a global template — the
 *       blanket grant is closed). This prevents cross-tenant template leakage;
 *     • a user listed in the shared_with jsonb array;
 *     • a user with a canvas_access grant at ANY level (read/write/admin);
 *     • a member of a channel that holds a canvas_access grant
 *       (grantee_type='channel') — channel readability matches userCanReadChannel
 *       (open channels still require workspace membership).
 *   WRITE — granted to:
 *     • the creator (always);
 *     • a user with a canvas_access grant at level 'write' or 'admin';
 *     • a member of a channel with a 'write'/'admin' canvas_access grant.
 *
 * Design note on shared_with vs canvas_access: shared_with is a VIEW-only share
 * (mirrors Slack "share canvas" = read). Editing is conferred only by an explicit
 * canvas_access 'write'/'admin' grant (mirrors Slack edit grants). This keeps the
 * two surfaces distinct: shared_with = quick read share, canvas_access = managed
 * permission grants. Soft-deleted canvases (deleted_at <> 0) are treated as
 * not-found by callers; this engine still resolves their row so a creator/admin
 * can act on the tombstone if needed — callers decide.
 *
 * All SQL is parameterized. No string interpolation of identifiers.
 */
import type { Pool } from 'pg'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'

export interface CanvasRow {
  id: string
  type: string
  channel_id: string | null
  workspace_id: string | null
  created_by: string | null
  shared_with: unknown
  deleted_at: number
}

export interface CanvasAccess {
  /** The canvas row, or null when the id does not exist. */
  canvas: CanvasRow | null
  canRead: boolean
  canWrite: boolean
  /** True when the canvas exists but has been soft-deleted. */
  deleted: boolean
}

const WRITE_LEVELS = new Set(['write', 'admin'])

function parseSharedWith(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]')
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

/** Load a canvas row by id (including soft-deleted). Null when unknown. */
export async function loadCanvas(pool: Pool, canvasId: string): Promise<CanvasRow | null> {
  const { rows } = await pool.query<CanvasRow>(
    `SELECT id, type, channel_id, workspace_id, created_by, shared_with, deleted_at
       FROM aaelink.canvases
      WHERE id = $1
      LIMIT 1`,
    [canvasId]
  )
  const row = rows[0]
  if (!row) return null
  return { ...row, deleted_at: Number(row.deleted_at || 0) }
}

/**
 * Resolve read/write access for a canvas given the calling user.
 *
 * Performs at most: one canvas_access grant lookup (rolled into a single query),
 * plus a channel-membership check when the canvas is a channel_canvas. Pass a
 * pre-loaded row to skip the initial SELECT.
 */
export async function resolveCanvasAccess(
  pool: Pool,
  uid: string,
  canvasIdOrRow: string | CanvasRow
): Promise<CanvasAccess> {
  const canvas =
    typeof canvasIdOrRow === 'string' ? await loadCanvas(pool, canvasIdOrRow) : canvasIdOrRow
  if (!canvas) return { canvas: null, canRead: false, canWrite: false, deleted: false }

  const deleted = Number(canvas.deleted_at || 0) !== 0

  // Creator always has full access.
  if (canvas.created_by && canvas.created_by === uid) {
    return { canvas, canRead: true, canWrite: true, deleted }
  }

  let canRead = false
  let canWrite = false

  // Type-based read access. Templates are WORKSPACE-scoped: readable only to
  // members of the canvas's workspace (a blank workspace_id is NOT a global
  // template — the old blanket `type==='template'` grant leaked cross-tenant).
  if (canvas.type === 'template' && canvas.workspace_id) {
    if (await isWorkspaceMember(pool, uid, canvas.workspace_id)) canRead = true
  }
  if (!canRead && canvas.type === 'channel_canvas' && canvas.channel_id) {
    if (await userCanReadChannel(pool, uid, canvas.channel_id)) canRead = true
  }

  // shared_with jsonb — read-only share.
  if (!canRead && parseSharedWith(canvas.shared_with).includes(uid)) canRead = true

  // canvas_access grants. A direct user grant, or a channel grant for a channel
  // the user can read. Resolve the highest applicable level in one query.
  // Channel-grant readability MUST match userCanReadChannel: an open ('O')
  // channel is readable only by members of its WORKSPACE (the INNER JOIN below),
  // not by anyone authenticated; private/group channels need explicit membership;
  // DMs need participation; workspace owner/admin bypasses the private gate.
  const { rows: grantRows } = await pool.query<{ access_level: string }>(
    `SELECT ca.access_level
       FROM aaelink.canvas_access ca
      WHERE ca.canvas_id = $1
        AND (
          (ca.grantee_type = 'user' AND ca.grantee_id = $2)
          OR (
            ca.grantee_type = 'channel' AND EXISTS (
              SELECT 1 FROM aaelink.channels c
              INNER JOIN aaelink.workspace_members wm
                ON wm.workspace_id = c.workspace_id AND wm.user_id = $2
              WHERE c.id = ca.grantee_id
                AND (
                  c.type = 'O'
                  OR (c.type IN ('P', 'G') AND EXISTS (
                    SELECT 1 FROM aaelink.channel_members cm
                    WHERE cm.channel_id = c.id AND cm.user_id = $2
                  ))
                  OR (c.type = 'D' AND (c.dm_user_a = $2 OR c.dm_user_b = $2))
                  OR wm.role IN ('owner', 'admin')
                )
            )
          )
        )`,
    [canvas.id, uid]
  )

  for (const g of grantRows) {
    canRead = true
    if (WRITE_LEVELS.has(g.access_level)) canWrite = true
  }

  return { canvas, canRead, canWrite, deleted }
}

/**
 * True when the user may administer grants on a canvas (set/revoke access).
 * The creator, a platform admin, or the holder of an 'admin' canvas_access grant.
 * Mirrors Slack: the canvas owner manages sharing; we also let platform admins in
 * for compliance/support.
 */
export async function canAdministerCanvas(
  pool: Pool,
  uid: string,
  canvas: CanvasRow
): Promise<boolean> {
  if (canvas.created_by && canvas.created_by === uid) return true

  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  if (isPlatformAdmin(rows[0]?.platform_role || '')) return true

  const { rows: grant } = await pool.query<{ access_level: string }>(
    `SELECT access_level FROM aaelink.canvas_access
      WHERE canvas_id = $1 AND grantee_type = 'user' AND grantee_id = $2 AND access_level = 'admin'
      LIMIT 1`,
    [canvas.id, uid]
  )
  return grant.length > 0
}

/**
 * SQL predicate restricting a canvas list query to rows the user may see, when
 * NOT scoping to a single channel or to "mine". Mirrors resolveCanvasAccess read
 * rules: creator / template / shared_with / canvas_access user-grant / readable
 * channel_canvas. `uidParamIndex` is the 1-based positional parameter holding the
 * uid (the caller pushes uid once and passes its index). Table alias is `c`.
 */
export function canvasListReadPredicate(uidParamIndex: number): string {
  const p = `$${uidParamIndex}`
  return `(
    c.created_by = ${p}
    OR (
      c.type = 'template' AND c.workspace_id <> '' AND EXISTS (
        SELECT 1 FROM aaelink.workspace_members wmt
        WHERE wmt.workspace_id = c.workspace_id AND wmt.user_id = ${p}
      )
    )
    OR c.shared_with @> to_jsonb(${p}::text)
    OR EXISTS (
      SELECT 1 FROM aaelink.canvas_access ca
      WHERE ca.canvas_id = c.id AND ca.grantee_type = 'user' AND ca.grantee_id = ${p}
    )
    OR (
      c.type = 'channel_canvas' AND c.channel_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM aaelink.channels ch
        INNER JOIN aaelink.workspace_members wm
          ON wm.workspace_id = ch.workspace_id AND wm.user_id = ${p}
        WHERE ch.id = c.channel_id
          AND (
            ch.type = 'O'
            OR (ch.type IN ('P', 'G') AND EXISTS (
              SELECT 1 FROM aaelink.channel_members cm
              WHERE cm.channel_id = ch.id AND cm.user_id = ${p}
            ))
            OR (ch.type = 'D' AND (ch.dm_user_a = ${p} OR ch.dm_user_b = ${p}))
            OR wm.role IN ('owner', 'admin')
          )
      )
    )
  )`
}

/**
 * Resolve the workspace a new canvas belongs to so it can be persisted and the
 * template read-scope can be enforced. For a channel_canvas the workspace is the
 * channel's; otherwise it is the caller's workspace. We pick the OLDEST workspace
 * the caller is a member of (created_at ASC) as their primary — deterministic and
 * matches how the test harness/system workspace is the oldest. Returns '' when it
 * cannot be resolved (e.g. the channel is missing); callers store '' and the
 * template read-grant treats an empty workspace_id as non-global (not readable).
 */
export async function resolveCanvasWorkspace(
  pool: Pool,
  uid: string,
  opts: { type: string; channelId?: string | null }
): Promise<string> {
  if (opts.type === 'channel_canvas' && opts.channelId) {
    const { rows } = await pool.query<{ workspace_id: string | null }>(
      `SELECT workspace_id FROM aaelink.channels WHERE id = $1 LIMIT 1`,
      [opts.channelId]
    )
    return rows[0]?.workspace_id || ''
  }
  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT wm.workspace_id
       FROM aaelink.workspace_members wm
       JOIN aaelink.workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
      ORDER BY w.created_at ASC
      LIMIT 1`,
    [uid]
  )
  return rows[0]?.workspace_id || ''
}

/** True when the user is a platform admin (super_admin / it_admin). */
export async function isPlatformAdminUser(pool: Pool, uid: string): Promise<boolean> {
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  return isPlatformAdmin(rows[0]?.platform_role || '')
}

export type TemplateBlock = { type: string; content?: string; [k: string]: unknown }

export type TemplateResolution =
  | { ok: true; blocks: TemplateBlock[] }
  | { ok: false; code: 'template_not_found' | 'forbidden' }

/**
 * Resolve the content_blocks to copy when instantiating a canvas from a template.
 * The source must exist, be live, and be readable to `uid` per resolveCanvasAccess
 * (templates are readable only to members of the template's workspace; any other
 * readable canvas can also seed a new one). Returns the blocks to copy; the caller
 * owns the new canvas.
 */
export async function resolveTemplateBlocks(
  pool: Pool, uid: string, templateId: string
): Promise<TemplateResolution> {
  const access = await resolveCanvasAccess(pool, uid, templateId)
  if (!access.canvas || access.deleted) return { ok: false, code: 'template_not_found' }
  if (!access.canRead) return { ok: false, code: 'forbidden' }
  const { rows } = await pool.query<{ content_blocks: unknown }>(
    `SELECT content_blocks FROM aaelink.canvases WHERE id = $1`, [templateId]
  )
  const raw = rows[0]?.content_blocks
  const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw ?? [])
  return { ok: true, blocks: Array.isArray(parsed) ? parsed : [] }
}
