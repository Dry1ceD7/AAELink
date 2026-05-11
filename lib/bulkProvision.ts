/**
 * AAELink — Bulk User Provisioning Engine
 *
 * Enterprise-grade bulk user import:
 *   - CSV and JSON format support
 *   - Conflict resolution strategies: skip, overwrite, merge
 *   - Field validation and normalization
 *   - Batch processing with progress tracking
 *   - Dry-run preview mode
 *   - Detailed import report with per-row errors
 *
 * Slack equivalents: admin.users.invite (bulk),
 *   admin.users.setRegular, admin.users.list
 */

import { randomUUID } from 'crypto'

// ── Types ────────────────────────────────────────────────────────────

export type ConflictStrategy = 'skip' | 'overwrite' | 'merge'

export interface BulkUserRecord {
  username: string
  email: string
  first_name?: string
  last_name?: string
  nickname?: string
  job_title?: string
  phone?: string
  timezone?: string
  department?: string
  platform_role?: string
  password?: string
}

export interface ImportOptions {
  /** How to handle username/email conflicts */
  conflict_strategy: ConflictStrategy
  /** Default password for users without one specified */
  default_password?: string
  /** Default platform role */
  default_role: string
  /** Default timezone */
  default_timezone: string
  /** Whether to send welcome emails */
  send_welcome_email: boolean
  /** Workspace ID to auto-add users to */
  auto_join_workspace_id?: string
  /** Max records to process per batch */
  batch_size: number
}

export interface RowResult {
  row: number
  username: string
  email: string
  status: 'created' | 'updated' | 'skipped' | 'error'
  user_id?: string
  error?: string
}

export interface ImportResult {
  preview: boolean
  total_rows: number
  created: number
  updated: number
  skipped: number
  errors: number
  rows: RowResult[]
  duration_ms: number
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  conflict_strategy: 'skip',
  default_role: 'member',
  default_timezone: 'Asia/Bangkok',
  send_welcome_email: false,
  batch_size: 100,
}

// ── Validation ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,64}$/

export function validateRecord(rec: BulkUserRecord, row: number): string | null {
  if (!rec.username || !USERNAME_RE.test(rec.username)) {
    return `row ${row}: invalid username "${rec.username}" — must be 2-64 chars, alphanumeric/underscore/dash/dot`
  }
  if (!rec.email || !EMAIL_RE.test(rec.email)) {
    return `row ${row}: invalid email "${rec.email}"`
  }
  if (rec.platform_role && !['admin', 'member', 'guest'].includes(rec.platform_role)) {
    return `row ${row}: invalid platform_role "${rec.platform_role}" — must be admin/member/guest`
  }
  return null
}

// ── CSV Parsing ──────────────────────────────────────────────────────

export function parseCsv(csvText: string): BulkUserRecord[] {
  const lines = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return [] // Need header + at least one row

  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["\s]/g, ''))

  const FIELD_MAP: Record<string, keyof BulkUserRecord> = {
    username: 'username',
    user_name: 'username',
    email: 'email',
    email_address: 'email',
    first_name: 'first_name',
    firstname: 'first_name',
    last_name: 'last_name',
    lastname: 'last_name',
    nickname: 'nickname',
    nick_name: 'nickname',
    job_title: 'job_title',
    jobtitle: 'job_title',
    title: 'job_title',
    phone: 'phone',
    phone_number: 'phone',
    timezone: 'timezone',
    tz: 'timezone',
    department: 'department',
    dept: 'department',
    role: 'platform_role',
    platform_role: 'platform_role',
    password: 'password',
  }

  const fieldIndices = new Map<keyof BulkUserRecord, number>()
  header.forEach((h, i) => {
    const mapped = FIELD_MAP[h]
    if (mapped) fieldIndices.set(mapped, i)
  })

  if (!fieldIndices.has('username') && !fieldIndices.has('email')) return []

  return lines.slice(1).map(line => {
    // Handle quoted CSV fields
    const cols = parseCsvLine(line)
    const rec: BulkUserRecord = {
      username: '',
      email: '',
    }
    for (const [field, idx] of fieldIndices) {
      const val = cols[idx]?.trim().replace(/^"|"$/g, '') || ''
      if (val) (rec as unknown as Record<string, string>)[field] = val
    }
    return rec
  })
}

/** Parse a single CSV line, handling quoted fields with commas */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

// ── Engine ───────────────────────────────────────────────────────────

export class BulkProvisionEngine {
  private options: ImportOptions

  constructor(options: Partial<ImportOptions> = {}) {
    this.options = { ...DEFAULT_IMPORT_OPTIONS, ...options }
  }

  getOptions(): ImportOptions {
    return { ...this.options }
  }

  /**
   * Preview import — validates all records without writing.
   */
  preview(records: BulkUserRecord[]): ImportResult {
    const start = Date.now()
    const rows: RowResult[] = []
    let created = 0, skipped = 0, errors = 0

    records.forEach((rec, i) => {
      const err = validateRecord(rec, i + 1)
      if (err) {
        rows.push({ row: i + 1, username: rec.username || '', email: rec.email || '', status: 'error', error: err })
        errors++
      } else {
        rows.push({ row: i + 1, username: rec.username, email: rec.email, status: 'created', user_id: `preview-${randomUUID().slice(0, 8)}` })
        created++
      }
    })

    return {
      preview: true,
      total_rows: records.length,
      created,
      updated: 0,
      skipped,
      errors,
      rows,
      duration_ms: Date.now() - start,
    }
  }

  /**
   * Execute bulk import against a DB interface.
   *
   * @param records   Parsed user records
   * @param lookupFn  Check if user exists by username/email → user_id or null
   * @param createFn  Create a new user → user_id
   * @param updateFn  Update an existing user
   */
  async execute(
    records: BulkUserRecord[],
    lookupFn: (username: string, email: string) => Promise<string | null>,
    createFn: (rec: BulkUserRecord & { id: string }) => Promise<void>,
    updateFn: (userId: string, rec: Partial<BulkUserRecord>) => Promise<void>,
  ): Promise<ImportResult> {
    const start = Date.now()
    const rows: RowResult[] = []
    let created = 0, updated = 0, skipped = 0, errors = 0

    // Process in batches
    for (let i = 0; i < records.length; i += this.options.batch_size) {
      const batch = records.slice(i, i + this.options.batch_size)

      for (let j = 0; j < batch.length; j++) {
        const rec = batch[j]
        const rowNum = i + j + 1
        const err = validateRecord(rec, rowNum)

        if (err) {
          rows.push({ row: rowNum, username: rec.username || '', email: rec.email || '', status: 'error', error: err })
          errors++
          continue
        }

        try {
          // Normalize
          rec.username = rec.username.toLowerCase().trim()
          rec.email = rec.email.toLowerCase().trim()
          rec.platform_role = rec.platform_role || this.options.default_role
          rec.timezone = rec.timezone || this.options.default_timezone

          const existingId = await lookupFn(rec.username, rec.email)

          if (existingId) {
            switch (this.options.conflict_strategy) {
              case 'skip':
                rows.push({ row: rowNum, username: rec.username, email: rec.email, status: 'skipped', user_id: existingId })
                skipped++
                break
              case 'overwrite':
                await updateFn(existingId, rec)
                rows.push({ row: rowNum, username: rec.username, email: rec.email, status: 'updated', user_id: existingId })
                updated++
                break
              case 'merge': {
                // Only update non-empty fields
                const partial: Partial<BulkUserRecord> = {}
                if (rec.first_name) partial.first_name = rec.first_name
                if (rec.last_name) partial.last_name = rec.last_name
                if (rec.nickname) partial.nickname = rec.nickname
                if (rec.job_title) partial.job_title = rec.job_title
                if (rec.phone) partial.phone = rec.phone
                if (rec.timezone) partial.timezone = rec.timezone
                if (rec.department) partial.department = rec.department
                if (Object.keys(partial).length > 0) {
                  await updateFn(existingId, partial)
                  rows.push({ row: rowNum, username: rec.username, email: rec.email, status: 'updated', user_id: existingId })
                  updated++
                } else {
                  rows.push({ row: rowNum, username: rec.username, email: rec.email, status: 'skipped', user_id: existingId })
                  skipped++
                }
                break
              }
            }
          } else {
            const id = randomUUID()
            await createFn({ ...rec, id })
            rows.push({ row: rowNum, username: rec.username, email: rec.email, status: 'created', user_id: id })
            created++
          }
        } catch (e) {
          rows.push({
            row: rowNum,
            username: rec.username || '',
            email: rec.email || '',
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
          })
          errors++
        }
      }
    }

    return {
      preview: false,
      total_rows: records.length,
      created,
      updated,
      skipped,
      errors,
      rows,
      duration_ms: Date.now() - start,
    }
  }
}
