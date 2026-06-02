import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { log } from '@/lib/infra/log'

/**
 * Append-only audit log writer.
 *
 * All write operations (message create/edit/delete, channel actions,
 * user management, webhook calls) SHOULD call writeAuditLog so that
 * platform admins have a compliance trail.
 *
 * The write is fire-and-forget — failures are swallowed and logged to
 * stderr so they never break the primary request path.
 */

export type AuditAction =
  | 'message.create'
  | 'message.edit'
  | 'message.delete'
  | 'channel.create'
  | 'channel.delete'
  | 'channel.update'
  | 'channel.member.add'
  | 'channel.member.remove'
  | 'workspace.member.add'
  | 'workspace.member.remove'
  | 'user.login'
  | 'user.logout'
  | 'user.register'
  | 'user.update'
  | 'webhook.create'
  | 'webhook.delete'
  | 'webhook.trigger'
  | 'document.upload'
  | 'document.delete'
  | string // allow arbitrary fine-grained actions

export interface AuditLogEntry {
  pool:          Pool
  workspaceId?:  string
  actorId?:      string
  actorRole?:    string
  action:        AuditAction
  resourceKind?: string
  resourceId?:   string
  ipAddress?:    string
  userAgent?:    string
  metadata?:     Record<string, unknown>
}

export function writeAuditLog(entry: AuditLogEntry): void {
  const id = randomUUID()
  const now = Date.now()
  entry.pool
    .query(
      `INSERT INTO aaelink.audit_log
         (id, workspace_id, actor_id, actor_role, action, resource_kind, resource_id,
          ip_address, user_agent, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        entry.workspaceId  ?? null,
        entry.actorId      ?? null,
        entry.actorRole    ?? '',
        entry.action,
        entry.resourceKind ?? '',
        entry.resourceId   ?? '',
        entry.ipAddress    ?? '',
        entry.userAgent    ?? '',
        JSON.stringify(entry.metadata ?? {}),
        now,
      ]
    )
    .catch((e) => log.error('[audit_log] write failed:', e))
}

/** Extract client IP from Next.js / Vercel request headers. */
export function extractIp(req: Request): string {
  const h = (name: string) =>
    (req.headers as Headers).get(name)?.split(',')[0]?.trim() ?? ''
  return h('x-forwarded-for') || h('x-real-ip') || ''
}
