import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { log } from '@/lib/infra/log'

/**
 * DLP (Data Loss Prevention) interceptor.
 *
 * Hooks into the message pipeline to scan content against active
 * DLP rules. Violations are recorded and enforcement actions
 * (block, redact, alert, quarantine) are executed synchronously.
 */

export type DlpAction = 'block' | 'redact' | 'alert' | 'quarantine' | 'warn'

export interface DlpRule {
  id:             string
  name:           string
  type:           string
  pattern:        string
  action:         DlpAction
  severity:       string
  priority:       number
  scope_channels: string[]
  is_active:      boolean
}

export interface DlpViolation {
  ruleId:     string
  userId:     string
  channelId:  string
  snippet:    string
  action:     DlpAction
}

export interface DlpScanResult {
  clean:      boolean
  violations: DlpViolation[]
  action:     DlpAction | null
}

/**
 * Load active DLP rules for a workspace.
 * Rules are workspace-scoped via scope_channels or global if empty.
 */
export async function getDlpRulesForWorkspace(workspaceId: string): Promise<DlpRule[]> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<DlpRule>(
    `SELECT * FROM aaelink.dlp_rules WHERE is_active = true ORDER BY priority DESC`,
  )
  return rows
}

/**
 * Scan message content against all active DLP rules.
 * Returns scan result with any violations found.
 */
export async function scanMessageContent(
  content: string,
  workspaceId: string,
  userId: string = '',
  channelId: string = ''
): Promise<DlpScanResult> {
  const rules = await getDlpRulesForWorkspace(workspaceId)

  const violations: DlpViolation[] = []
  let highestAction: DlpAction | null = null
  const actionPriority: Record<DlpAction, number> = {
    block: 4, quarantine: 3, redact: 2, alert: 1, warn: 0,
  }

  for (const rule of rules) {
    // Scope check — if rule targets specific channels, skip others
    if (rule.scope_channels?.length > 0 && !rule.scope_channels.includes(channelId)) {
      continue
    }

    let matched = false
    try {
      if (rule.type === 'pattern_match' || rule.type === 'regex') {
        const re = new RegExp(rule.pattern, 'gi')
        matched = re.test(content)
      } else if (rule.type === 'keyword') {
        matched = content.toLowerCase().includes(rule.pattern.toLowerCase())
      }
    } catch {
      log.error(`[dlp] invalid pattern in rule ${rule.id}: ${rule.pattern}`)
    }

    if (matched) {
      const action = rule.action as DlpAction
      violations.push({
        ruleId: rule.id,
        userId,
        channelId,
        snippet: content.slice(0, 200),
        action,
      })
      if (!highestAction || actionPriority[action] > actionPriority[highestAction]) {
        highestAction = action
      }
    }
  }

  return {
    clean: violations.length === 0,
    violations,
    action: highestAction,
  }
}

/** Record a DLP violation in the violations log. */
export async function recordDlpViolation(v: DlpViolation): Promise<void> {
  const pool = getPool()
  if (!pool) return
  const id = randomUUID()
  await pool.query(
    `INSERT INTO aaelink.dlp_violations (id, rule_id, user_id, channel_id, content_snippet, action_taken, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, v.ruleId, v.userId, v.channelId, v.snippet, v.action, Date.now()]
  ).catch((e) => log.error('[dlp] violation record failed:', e))
}

/**
 * Execute the enforcement action for a DLP violation.
 * Returns true if the message should be blocked from sending.
 */
export async function enforceDlpAction(
  action: DlpAction,
  messageId: string
): Promise<boolean> {
  const pool = getPool()

  switch (action) {
    case 'block':
      // Message should not be delivered
      return true
    case 'quarantine':
      // Move to scan queue for manual review
      if (pool) {
        await pool.query(
          `UPDATE aaelink.dlp_scan_queue SET status = 'violation'
           WHERE message_id = $1`,
          [messageId]
        ).catch((e) => log.error('[dlp] quarantine failed:', e))
      }
      return true
    case 'redact':
      // Caller should redact the content before delivery
      return false
    case 'alert':
    case 'warn':
      // Allow message, just notify admins
      return false
    default:
      return false
  }
}
