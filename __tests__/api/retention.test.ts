/**
 * Integration tests for /api/admin/retention (engine surface).
 *
 * Hard rule #8: a changed route gets __tests__/api/ coverage. The change under
 * test is the RetentionEngine 'files' repoint from the phantom 'aaelink.files'
 * to the canonical 'aaelink.file_attachments' (lib/enterprise/retention.ts), and
 * the new guard that makes execute('files') refuse a real DELETE (degrades to a
 * preview). Both are consumed by POST /api/admin/retention.
 *
 * Coverage:
 *   - auth guards (401 / 403 / 200) on POST
 *   - action=list_engine_policies pins the 'files' table → aaelink.file_attachments
 *   - action=preview entity=files runs without error against the live table
 *   - action=execute entity=files dry_run=false NEVER hard-deletes (guard degrades
 *     it to a dry-run/preview) — verified by seeding a real, old file row and
 *     asserting it survives the call
 *   - the repointed engine COUNT actually queries file_attachments (live PG),
 *     exercised through the same pool.query queryFn the route uses
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'
import { RetentionEngine, type RetentionQueryFn } from '@/lib/enterprise/retention'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const userIds: string[] = []
const fileIds: string[] = []

const DAY_MS = 86_400_000

/** Seed a file_attachments row owned by `owner`, created `ageDays` ago. */
async function seedOldFile(ownerId: string, ageDays: number): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, message_id, channel_id, user_id, filename, content_type, size, storage_key, created_at)
     VALUES ($1, NULL, NULL, $2, 'old.txt', 'text/plain', 10, $3, $4)`,
    [id, ownerId, `local/${id}`, Date.now() - ageDays * DAY_MS]
  )
  fileIds.push(id)
  return id
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, employee.id)
})

afterAll(async () => {
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('POST /api/admin/retention — auth', () => {
  it('returns 401 without a session', async () => {
    const { POST } = await import('@/app/api/admin/retention/route')
    const req = asRequest('POST', '/api/admin/retention', {
      body: { action: 'list_engine_policies' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-admin', async () => {
    const { POST } = await import('@/app/api/admin/retention/route')
    const req = asRequest('POST', '/api/admin/retention', {
      cookie: employee.sessionCookie,
      body: { action: 'list_engine_policies' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/admin/retention — 'files' repoint + guard", () => {
  it("list_engine_policies pins the 'files' entry to aaelink.file_attachments", async () => {
    const { POST } = await import('@/app/api/admin/retention/route')
    const req = asRequest('POST', '/api/admin/retention', {
      cookie: admin.sessionCookie,
      body: { action: 'list_engine_policies' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      policies: Array<{ entity: string; table: string; timestampColumn: string }>
    }
    const files = body.policies.find(p => p.entity === 'files')
    expect(files).toBeDefined()
    expect(files!.table).toBe('aaelink.file_attachments')
    expect(files!.timestampColumn).toBe('created_at')
  })

  it('preview entity=files runs against the live table without error', async () => {
    const { POST } = await import('@/app/api/admin/retention/route')
    const req = asRequest('POST', '/api/admin/retention', {
      cookie: admin.sessionCookie,
      body: { action: 'preview', entity: 'files' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { entity: string; deleted: number; dryRun: boolean } }
    expect(body.result.entity).toBe('files')
    expect(body.result.dryRun).toBe(true)
    // Default 'files' policy is keep-forever (retentionDays 0) → deleted 0; the
    // point is the route path no longer throws on a phantom table.
    expect(body.result.deleted).toBe(0)
  })

  it('execute entity=files with dry_run=false NEVER hard-deletes (guard degrades to preview)', async () => {
    // Seed a row that WOULD be in range if a positive retention window existed —
    // it must survive the call regardless, because the engine refuses to DELETE
    // file rows (file purges go through the byte/hold-aware worker path only).
    const fileId = await seedOldFile(admin.id, 400)

    const { POST } = await import('@/app/api/admin/retention/route')
    const req = asRequest('POST', '/api/admin/retention', {
      cookie: admin.sessionCookie,
      body: { action: 'execute', entity: 'files', dry_run: false },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { entity: string; dryRun: boolean } }
    expect(body.result.entity).toBe('files')
    // The guard forces a dry-run even though dry_run:false was requested.
    expect(body.result.dryRun).toBe(true)

    // The seeded file row is still present — nothing was hard-deleted.
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.file_attachments WHERE id = $1`, [fileId]
    )
    expect(rows).toHaveLength(1)
  })

  it('the repointed engine COUNT actually queries file_attachments (live PG)', async () => {
    // Exercise the exact queryFn the route uses (pool.query) against the engine
    // with a positive retention window so the COUNT runs against the real table.
    const old = await seedOldFile(admin.id, 200)

    const engine = new RetentionEngine([
      { entity: 'files', retentionDays: 30, enabled: true },
    ])
    const queryFn: RetentionQueryFn = (sql, params) =>
      ctx.pool.query<{ count: number }>(sql, params)

    const result = await engine.preview('files', queryFn)
    // COUNT ran against aaelink.file_attachments and saw at least the seeded row.
    expect(result.cutoffDate).not.toBe('keep_forever')
    expect(result.deleted).toBeGreaterThanOrEqual(1)

    // And execute('files') is still guarded — it counts, never deletes.
    const exec = await engine.execute('files', queryFn, false)
    expect(exec.dryRun).toBe(true)
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.file_attachments WHERE id = $1`, [old]
    )
    expect(rows).toHaveLength(1)
  })
})
