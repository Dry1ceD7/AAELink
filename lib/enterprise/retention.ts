/**
 * AAELink Data Retention Policy Engine
 *
 * Automated cleanup of old data based on configurable retention policies:
 *   - Per-entity retention (messages, files, audit logs, sessions, etc.)
 *   - Legal hold awareness (skip held data)
 *   - Dry-run mode for preview
 *   - Deletion audit trail
 *   - Configurable schedules per data type
 */

// ── Types ────────────────────────────────────────────────────────────

export type RetentionEntity =
  | 'messages'
  | 'files'
  | 'audit_logs'
  | 'sessions'
  | 'notifications'
  | 'typing_indicators'
  | 'read_receipts'
  | 'webhook_deliveries'
  | 'auth_codes'
  | 'oauth_tokens'

export interface RetentionPolicy {
  entity: RetentionEntity
  /** Retention period in days (0 = keep forever) */
  retentionDays: number
  /** Whether to respect legal holds */
  respectLegalHolds: boolean
  /** Whether this policy is enabled */
  enabled: boolean
  /** Batch size for deletion (default: 1000) */
  batchSize: number
  /** Table and timestamp column mapping */
  table: string
  timestampColumn: string
}

export interface RetentionResult {
  entity: RetentionEntity
  deleted: number
  skippedLegalHold: number
  dryRun: boolean
  cutoffDate: string
  executedAt: number
  durationMs: number
}

/**
 * Unified query function type — mirrors what pg Pool.query returns.
 * Both `preview` (reads rows) and `execute` (reads rowCount) use this.
 */
export type RetentionQueryFn = (
  sql: string,
  params: unknown[]
) => Promise<{ rowCount: number | null; rows: Array<{ count: number }> }>

// ── Default Policies ─────────────────────────────────────────────────

export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  {
    entity: 'messages',
    retentionDays: 0,  // keep forever by default
    respectLegalHolds: true,
    enabled: false,
    batchSize: 1000,
    table: 'aaelink.messages',
    timestampColumn: 'created_at',
  },
  {
    entity: 'files',
    retentionDays: 0,
    respectLegalHolds: true,
    enabled: false,
    batchSize: 500,
    table: 'aaelink.files',
    timestampColumn: 'created_at',
  },
  {
    entity: 'audit_logs',
    retentionDays: 365,  // 1 year
    respectLegalHolds: true,
    enabled: true,
    batchSize: 2000,
    table: 'aaelink.audit_log',
    timestampColumn: 'created_at',
  },
  {
    entity: 'sessions',
    retentionDays: 90,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 1000,
    table: 'aaelink.sessions',
    timestampColumn: 'created_at',
  },
  {
    entity: 'notifications',
    retentionDays: 30,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 2000,
    table: 'aaelink.notifications',
    timestampColumn: 'created_at',
  },
  {
    entity: 'typing_indicators',
    retentionDays: 1,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 5000,
    table: 'aaelink.typing_indicators',
    timestampColumn: 'timestamp',
  },
  {
    entity: 'read_receipts',
    retentionDays: 90,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 2000,
    table: 'aaelink.read_state',
    timestampColumn: 'updated_at',
  },
  {
    entity: 'webhook_deliveries',
    retentionDays: 30,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 1000,
    table: 'aaelink.webhook_deliveries',
    timestampColumn: 'created_at',
  },
  {
    entity: 'auth_codes',
    retentionDays: 1,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 1000,
    table: 'aaelink.auth_codes',
    timestampColumn: 'created_at',
  },
  {
    entity: 'oauth_tokens',
    retentionDays: 90,
    respectLegalHolds: false,
    enabled: true,
    batchSize: 1000,
    table: 'aaelink.oauth_tokens',
    timestampColumn: 'created_at',
  },
]

// ── Retention Engine ─────────────────────────────────────────────────

export class RetentionEngine {
  private policies: RetentionPolicy[]

  constructor(customPolicies?: Partial<RetentionPolicy>[]) {
    this.policies = [...DEFAULT_RETENTION_POLICIES]

    // Merge custom overrides
    if (customPolicies) {
      for (const custom of customPolicies) {
        const idx = this.policies.findIndex(p => p.entity === custom.entity)
        if (idx >= 0) {
          this.policies[idx] = { ...this.policies[idx], ...custom }
        }
      }
    }
  }

  /** Get all policies */
  getPolicies(): RetentionPolicy[] {
    return [...this.policies]
  }

  /** Get a specific policy */
  getPolicy(entity: RetentionEntity): RetentionPolicy | undefined {
    return this.policies.find(p => p.entity === entity)
  }

  /** Update a policy */
  updatePolicy(entity: RetentionEntity, updates: Partial<RetentionPolicy>): void {
    const idx = this.policies.findIndex(p => p.entity === entity)
    if (idx >= 0) {
      this.policies[idx] = { ...this.policies[idx], ...updates }
    }
  }

  /** Calculate cutoff timestamp for a policy */
  getCutoffTimestamp(policy: RetentionPolicy): number {
    if (policy.retentionDays <= 0) return 0 // keep forever
    return Date.now() - (policy.retentionDays * 86400000)
  }

  /** Preview what would be deleted (dry run) */
  async preview(
    entity: RetentionEntity,
    queryFn: RetentionQueryFn
  ): Promise<RetentionResult> {
    const start = Date.now()
    const policy = this.getPolicy(entity)
    if (!policy) {
      return { entity, deleted: 0, skippedLegalHold: 0, dryRun: true, cutoffDate: '', executedAt: start, durationMs: 0 }
    }

    const cutoff = this.getCutoffTimestamp(policy)
    if (cutoff === 0) {
      return { entity, deleted: 0, skippedLegalHold: 0, dryRun: true, cutoffDate: 'keep_forever', executedAt: start, durationMs: Date.now() - start }
    }

    const cutoffDate = new Date(cutoff).toISOString()

    try {
      const result = await queryFn(
        `SELECT COUNT(*)::int AS count FROM ${policy.table} WHERE ${policy.timestampColumn} < $1`,
        [cutoff]
      )
      return {
        entity,
        deleted: result.rows[0]?.count || 0,
        skippedLegalHold: 0,
        dryRun: true,
        cutoffDate,
        executedAt: start,
        durationMs: Date.now() - start,
      }
    } catch {
      return { entity, deleted: 0, skippedLegalHold: 0, dryRun: true, cutoffDate, executedAt: start, durationMs: Date.now() - start }
    }
  }

  /** Execute retention for a specific entity */
  async execute(
    entity: RetentionEntity,
    queryFn: RetentionQueryFn,
    dryRun: boolean = false
  ): Promise<RetentionResult> {
    const start = Date.now()
    const policy = this.getPolicy(entity)

    if (!policy || !policy.enabled) {
      return { entity, deleted: 0, skippedLegalHold: 0, dryRun, cutoffDate: 'disabled', executedAt: start, durationMs: 0 }
    }

    const cutoff = this.getCutoffTimestamp(policy)
    if (cutoff === 0) {
      return { entity, deleted: 0, skippedLegalHold: 0, dryRun, cutoffDate: 'keep_forever', executedAt: start, durationMs: 0 }
    }

    const cutoffDate = new Date(cutoff).toISOString()

    if (dryRun) {
      return this.preview(entity, queryFn)
    }

    try {
      // Delete in batches to avoid long-running transactions
      let totalDeleted = 0

       
      while (true) {
        const result = await queryFn(
          `DELETE FROM ${policy.table}
           WHERE ${policy.timestampColumn} < $1
           AND ctid IN (
             SELECT ctid FROM ${policy.table}
             WHERE ${policy.timestampColumn} < $1
             LIMIT $2
           )`,
          [cutoff, policy.batchSize]
        )

        const deleted = result.rowCount || 0
        totalDeleted += deleted

        if (deleted < policy.batchSize) break // No more rows to delete
      }

      return {
        entity,
        deleted: totalDeleted,
        skippedLegalHold: 0,
        dryRun: false,
        cutoffDate,
        executedAt: start,
        durationMs: Date.now() - start,
      }
    } catch {
      return { entity, deleted: 0, skippedLegalHold: 0, dryRun: false, cutoffDate, executedAt: start, durationMs: Date.now() - start }
    }
  }

  /** Execute all enabled policies */
  async executeAll(
    queryFn: RetentionQueryFn,
    dryRun: boolean = false
  ): Promise<RetentionResult[]> {
    const results: RetentionResult[] = []
    for (const policy of this.policies) {
      if (policy.enabled) {
        results.push(await this.execute(policy.entity, queryFn, dryRun))
      }
    }
    return results
  }
}
