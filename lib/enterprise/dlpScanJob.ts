/**
 * dlp_scan job orchestration — real content matching engine.
 *
 * Resolves the target content (inline `content`, a message body, or a file's
 * stored bytes), matches it against active DLP rules, records a dlp_violations
 * row per match, and audits when violations are found.
 */
import type { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { matchDlpRules, type DlpRule } from './dlpInterceptor'
import { writeAuditLog } from './auditLog'

const UPLOAD_DIR = process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

export interface DlpScanPayload {
  content?: string
  message_id?: string
  file_id?: string
  channel_id?: string
  user_id?: string
}

export interface DlpScanJobResult {
  clean: boolean
  violations: number
  action: string | null
}

async function loadActiveRules(pool: Pool): Promise<DlpRule[]> {
  const { rows } = await pool.query<DlpRule>(
    `SELECT * FROM aaelink.dlp_rules WHERE is_active = true ORDER BY priority DESC`
  )
  return rows
}

/** Resolve the text to scan and the channel/user context for the payload. */
async function resolveTarget(
  pool: Pool, p: DlpScanPayload
): Promise<{ content: string; channelId: string; userId: string }> {
  let content = p.content ?? ''
  let channelId = p.channel_id ?? ''
  let userId = p.user_id ?? ''

  if (!content && p.message_id) {
    const { rows } = await pool.query<{ body: string; channel_id: string; user_id: string }>(
      `SELECT body, channel_id, user_id FROM aaelink.messages WHERE id = $1`, [p.message_id]
    )
    if (rows[0]) {
      content = rows[0].body || ''
      channelId = channelId || rows[0].channel_id
      userId = userId || rows[0].user_id
    }
  }

  if (!content && p.file_id) {
    const { rows } = await pool.query<{ storage_key: string; channel_id: string; user_id: string }>(
      `SELECT storage_key, channel_id, user_id FROM aaelink.file_attachments WHERE id = $1`, [p.file_id]
    )
    if (rows[0]) {
      channelId = channelId || rows[0].channel_id
      userId = userId || rows[0].user_id
      try {
        content = fs.readFileSync(path.join(UPLOAD_DIR, rows[0].storage_key), 'utf8')
      } catch { /* non-text or missing — leave content empty */ }
    }
  }

  return { content, channelId, userId }
}

export async function runDlpScan(
  pool: Pool, payload: DlpScanPayload
): Promise<DlpScanJobResult> {
  const rules = await loadActiveRules(pool)
  if (rules.length === 0) return { clean: true, violations: 0, action: null }

  const { content, channelId, userId } = await resolveTarget(pool, payload)
  if (!content) return { clean: true, violations: 0, action: null }

  const scan = matchDlpRules(content, rules, userId, channelId)

  for (const v of scan.violations) {
    await pool.query(
      `INSERT INTO aaelink.dlp_violations
         (id, rule_id, user_id, channel_id, content_snippet, action_taken, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), v.ruleId, v.userId || null, v.channelId || null, v.snippet, v.action, Date.now()]
    )
  }

  if (scan.violations.length > 0) {
    writeAuditLog({
      pool,
      actorId: userId || undefined,
      action: 'dlp.violation',
      resourceKind: payload.message_id ? 'message' : payload.file_id ? 'file' : 'content',
      resourceId: payload.message_id || payload.file_id || '',
      metadata: { violations: scan.violations.length, action: scan.action, channel_id: channelId },
    })
  }

  return { clean: scan.clean, violations: scan.violations.length, action: scan.action }
}
