/**
 * Integration tests for the file-comments parity hardening (Files 18/19).
 *
 * Closes three gaps in app/api/files/comments/route.ts:
 *   1. GET list had NO read gate — anyone could list comments for any file id.
 *      Read access now mirrors the canonical download route (uploader, or
 *      channel read access for a channel-attached file). Denied as 404.
 *   2. POST mutations had NO verifyCsrf — now CSRF-gated (403 csrf*).
 *   3. Writes had NO audit log — add/edit/delete now write an audit row.
 *
 * Run against a live Postgres (vitest.integration.config.ts). The file is
 * attached to a PRIVATE channel the outsider is not a member of, so the read
 * gate has something to actually deny.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  createTestChannel,
  asRequest,
  expectError,
  expectSuccess,
  TestContext,
  TestUser,
  TestChannel,
} from '../helpers'

import { GET as COMMENTS_GET, POST as COMMENTS_POST } from '@/app/api/files/comments/route'

let ctx: TestContext
let owner: TestUser
let outsider: TestUser
let channel: TestChannel
let fileId: string
const userIds: string[] = []

/** Poll for a fire-and-forget audit row (writeAuditLog is not awaited). */
async function waitForAudit(action: string, resourceId: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log WHERE action = $1 AND resource_id = $2`, [action, resourceId]
    )
    if (rows.length > 0) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id, outsider.id)

  // Private channel owned by `owner`; outsider is NOT a member.
  channel = await createTestChannel(ctx.pool, owner.id, { type: 'private' })

  // File attached to that private channel, uploaded by owner.
  fileId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.file_attachments
       (id, channel_id, user_id, filename, content_type, size, storage_key, created_at)
     VALUES ($1,$2,$3,'doc.pdf','application/pdf',1234,$4,$5)`,
    [fileId, channel.id, owner.id, `s3://bucket/${fileId}`, Date.now()]
  )
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.file_comments WHERE file_id = $1`, [fileId])
  await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = $1`, [fileId])
  await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE actor_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('GET /api/files/comments — read gate', () => {
  it('denies an outsider listing comments for a file they cannot read (404)', async () => {
    const res = await COMMENTS_GET(asRequest('GET', '/api/files/comments', {
      cookie: outsider.sessionCookie,
      query: { file_id: fileId },
    }))
    await expectError(res, 404, 'not_found')
  })

  it('denies a list for an unknown file id (404, no existence oracle)', async () => {
    const res = await COMMENTS_GET(asRequest('GET', '/api/files/comments', {
      cookie: owner.sessionCookie,
      query: { file_id: randomUUID() },
    }))
    await expectError(res, 404, 'not_found')
  })

  it('rejects an unauthenticated list (401)', async () => {
    const res = await COMMENTS_GET(asRequest('GET', '/api/files/comments', {
      query: { file_id: fileId },
    }))
    await expectError(res, 401, 'unauthorized')
  })

  it('allows the uploader to list (200)', async () => {
    const res = await COMMENTS_GET(asRequest('GET', '/api/files/comments', {
      cookie: owner.sessionCookie,
      query: { file_id: fileId },
    }))
    const body = await expectSuccess<{ comments: unknown[] }>(res)
    expect(Array.isArray(body.comments)).toBe(true)
  })
})

describe('POST /api/files/comments — CSRF + audit + access', () => {
  it('rejects a mutation without a CSRF token (403 csrf*)', async () => {
    const res = await COMMENTS_POST(asRequest('POST', '/api/files/comments', {
      cookie: owner.sessionCookie,
      body: { action: 'add', file_id: fileId, comment: 'hi' },
      noAutoCsrf: true,
    }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error.startsWith('csrf')).toBe(true)
  })

  it('denies an outsider mutation on a file they cannot read (404)', async () => {
    const res = await COMMENTS_POST(asRequest('POST', '/api/files/comments', {
      cookie: outsider.sessionCookie,
      body: { action: 'add', file_id: fileId, comment: 'sneaky' },
    }))
    await expectError(res, 404, 'not_found')
  })

  it('completes the authorized add → edit → delete flow and audits each write', async () => {
    // ADD
    const addRes = await COMMENTS_POST(asRequest('POST', '/api/files/comments', {
      cookie: owner.sessionCookie,
      body: { action: 'add', file_id: fileId, comment: 'first' },
    }))
    const added = await expectSuccess<{ ok: boolean; comment_id: string }>(addRes)
    expect(added.ok).toBe(true)
    expect(added.comment_id).toBeTruthy()
    expect(await waitForAudit('file.comment.create', added.comment_id)).toBe(true)

    // The new comment is visible to the uploader's list.
    const listRes = await COMMENTS_GET(asRequest('GET', '/api/files/comments', {
      cookie: owner.sessionCookie,
      query: { file_id: fileId },
    }))
    const list = await expectSuccess<{ comments: { id: string; comment: string }[] }>(listRes)
    expect(list.comments.some(c => c.id === added.comment_id && c.comment === 'first')).toBe(true)

    // EDIT
    const editRes = await COMMENTS_POST(asRequest('POST', '/api/files/comments', {
      cookie: owner.sessionCookie,
      body: { action: 'edit', file_id: fileId, comment_id: added.comment_id, comment: 'edited' },
    }))
    await expectSuccess(editRes)
    expect(await waitForAudit('file.comment.edit', added.comment_id)).toBe(true)
    const { rows: afterEdit } = await ctx.pool.query<{ comment: string }>(
      `SELECT comment FROM aaelink.file_comments WHERE id = $1`, [added.comment_id]
    )
    expect(afterEdit[0]?.comment).toBe('edited')

    // DELETE
    const delRes = await COMMENTS_POST(asRequest('POST', '/api/files/comments', {
      cookie: owner.sessionCookie,
      body: { action: 'delete', file_id: fileId, comment_id: added.comment_id },
    }))
    await expectSuccess(delRes)
    expect(await waitForAudit('file.comment.delete', added.comment_id)).toBe(true)
    const { rows: afterDel } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.file_comments WHERE id = $1`, [added.comment_id]
    )
    expect(afterDel.length).toBe(0)
  })
})
