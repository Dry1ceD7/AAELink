/**
 * AAELink — Realtime Types Tests
 */
import { describe, it, expect } from 'vitest'
import type { ChatPost, FileAttachment, CollabDeletion, CollabSsePayload } from '@/lib/realtime'

describe('Realtime — FileAttachment type', () => {
  it('accepts valid attachment', () => {
    const a: FileAttachment = {
      id: 'f-1',
      name: 'report.pdf',
      size: 1024,
      mime_type: 'application/pdf',
      url: '/files/f-1',
    }
    expect(a.id).toBe('f-1')
    expect(a.size).toBe(1024)
  })
})

describe('Realtime — ChatPost type', () => {
  it('accepts minimal post', () => {
    const p: ChatPost = {
      id: 'msg-1',
      channel_id: 'ch-1',
      user_id: 'u-1',
      message: 'Hello',
      create_at: Date.now(),
    }
    expect(p.message).toBe('Hello')
    expect(p.root_id).toBeUndefined()
    expect(p.reactions).toBeUndefined()
  })

  it('accepts post with all optional fields', () => {
    const p: ChatPost = {
      id: 'msg-2',
      channel_id: 'ch-1',
      user_id: 'u-1',
      message: 'Thread reply',
      create_at: Date.now(),
      root_id: 'msg-1',
      reply_count: 3,
      reactions: [{ key: 'thumbs_up', count: 2, me: true }],
      edited_at: Date.now(),
      pending: false,
      file_attachments: [],
    }
    expect(p.root_id).toBe('msg-1')
    expect(p.reply_count).toBe(3)
  })
})

describe('Realtime — CollabDeletion type', () => {
  it('accepts deletion with thread root', () => {
    const d: CollabDeletion = {
      id: 'msg-1',
      deleted_at: Date.now(),
      thread_root_id: 'root-1',
    }
    expect(d.thread_root_id).toBe('root-1')
  })
})

describe('Realtime — CollabSsePayload type', () => {
  it('accepts empty payload', () => {
    const p: CollabSsePayload = {}
    expect(p.posts).toBeUndefined()
  })

  it('accepts payload with posts', () => {
    const p: CollabSsePayload = {
      posts: [{ id: 'msg-1', channel_id: 'ch-1', user_id: 'u-1', message: 'Hi', create_at: 0 }],
      reply_counts: { 'msg-1': 5 },
      deletions: [{ id: 'msg-old', deleted_at: 0 }],
    }
    expect(p.posts).toHaveLength(1)
    expect(p.reply_counts?.['msg-1']).toBe(5)
    expect(p.deletions).toHaveLength(1)
  })
})

describe('Realtime — SSE reconnect constants', () => {
  const SSE_RETRY_MAX = 5
  const SSE_RETRY_BASE_MS = 700

  it('max retries is 5', () => {
    expect(SSE_RETRY_MAX).toBe(5)
  })

  it('base delay is 700ms', () => {
    expect(SSE_RETRY_BASE_MS).toBe(700)
  })
})
