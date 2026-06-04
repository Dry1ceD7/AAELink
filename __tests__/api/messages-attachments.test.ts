/**
 * Integration test for /api/messages/attachments after the GET JOIN was
 * repointed from aaelink.documents → aaelink.file_attachments (the canonical
 * chat-file table, migration 033).
 *
 * Verifies the repointed JOIN end to end against a live Postgres:
 *   - upload a real file, attach it to a message, GET the attachments
 *   - the returned row carries the renamed aliases populated
 *     (filename / file_size / mime_type / storage_key)
 *   - a soft-deleted file is excluded by the `AND f.deleted_at = 0` join clause
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import {
  createTestContext,
  createTestUser,
  createTestChannel,
  createTestMessage,
  asRequest,
  expectSuccess,
  TestContext,
  TestUser,
  TestChannel,
} from '../helpers'

import { POST as UPLOAD_POST } from '@/app/api/files/upload/route'
import { GET as ATTACH_GET, POST as ATTACH_POST } from '@/app/api/messages/attachments/route'

let ctx: TestContext
let owner: TestUser
let channel: TestChannel
let messageId: string
const userIds: string[] = []
const fileIds: string[] = []

function csrfToken(): string {
  const secret = process.env.CSRF_SECRET || 'test-csrf-secret'
  const raw = randomUUID().replace(/-/g, '')
  const sig = createHmac('sha256', secret).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}

type NextRequestLike = Parameters<typeof UPLOAD_POST>[0]

/** Upload a real file via the upload route (multipart), return its id. */
async function doUpload(filename: string, type: string): Promise<string> {
  const fd = new FormData()
  fd.set('file', new Blob([Buffer.from('attachment-bytes')], { type }), filename)
  fd.set('channel_id', channel.id)

  const token = csrfToken()
  const cookie = `${owner.sessionCookie}; AAELINK_CSRF=${token}`
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie
  const headers = new Headers()
  headers.set('cookie', cookie)
  headers.set('x-csrf-token', token)
  const req = new Request('http://localhost:3040/api/files/upload', {
    method: 'POST', headers, body: fd,
  }) as unknown as NextRequestLike

  const res = await UPLOAD_POST(req)
  const body = await expectSuccess<{ attachment: { id: string } }>(res)
  fileIds.push(body.attachment.id)
  return body.attachment.id
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
  channel = await createTestChannel(ctx.pool, owner.id)
  messageId = await createTestMessage(ctx.pool, channel.id, owner.id, 'msg with attachments')
})

afterAll(async () => {
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE payload LIKE ANY($1)`,
      [fileIds.map(id => `%${id}%`)])
    await ctx.pool.query(`DELETE FROM aaelink.file_scans WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.message_attachments WHERE file_id = ANY($1)`, [fileIds])
    await ctx.pool.query(`DELETE FROM aaelink.file_attachments WHERE id = ANY($1)`, [fileIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = $1`, [messageId])
  await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = $1`, [channel.id])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('GET /api/messages/attachments (repointed file_attachments JOIN)', () => {
  it('returns the attached file with renamed aliases populated', async () => {
    const fileId = await doUpload('doc.pdf', 'application/pdf')

    const attachRes = await ATTACH_POST(asRequest('POST', '/api/messages/attachments', {
      cookie: owner.sessionCookie,
      body: { message_id: messageId, file_ids: [fileId] },
    }))
    await expectSuccess(attachRes)

    const res = await ATTACH_GET(asRequest('GET', '/api/messages/attachments', {
      cookie: owner.sessionCookie,
      query: { message_id: messageId },
    }))
    const body = await expectSuccess<{ attachments: Array<{
      file_id: string; filename: string; file_size: number
      mime_type: string; storage_key: string
    }> }>(res)

    const row = body.attachments.find(a => a.file_id === fileId)
    expect(row).toBeTruthy()
    expect(row!.filename).toBe('doc.pdf')
    expect(row!.mime_type).toBe('application/pdf')
    expect(Number(row!.file_size)).toBeGreaterThan(0)
    expect(row!.storage_key).toBeTruthy()
  })

  it('excludes a soft-deleted file from the JOIN', async () => {
    const fileId = await doUpload('gone.pdf', 'application/pdf')

    const attachRes = await ATTACH_POST(asRequest('POST', '/api/messages/attachments', {
      cookie: owner.sessionCookie,
      body: { message_id: messageId, file_ids: [fileId] },
    }))
    await expectSuccess(attachRes)

    // Soft-delete the underlying file directly.
    await ctx.pool.query(
      `UPDATE aaelink.file_attachments SET deleted_at = $1 WHERE id = $2`,
      [Date.now(), fileId]
    )

    const res = await ATTACH_GET(asRequest('GET', '/api/messages/attachments', {
      cookie: owner.sessionCookie,
      query: { message_id: messageId },
    }))
    const body = await expectSuccess<{ attachments: Array<{ file_id: string }> }>(res)
    expect(body.attachments.some(a => a.file_id === fileId)).toBe(false)
  })
})
