/**
 * AAELink — Message Cache Type Tests
 */
import { describe, it, expect } from 'vitest'
import type { CachedPost } from '@/lib/messaging/messageCache'

describe('MessageCache — CachedPost shape', () => {
  it('accepts valid cached post', () => {
    const p: CachedPost = {
      id: 'msg-1',
      channel_id: 'ch-1',
      user_id: 'u-1',
      message: 'test message',
      create_at: Date.now(),
    }
    expect(p.id).toBe('msg-1')
    expect(p.root_id).toBeUndefined()
    expect(p.reply_count).toBeUndefined()
    expect(p.edited_at).toBeUndefined()
  })

  it('accepts optional fields', () => {
    const p: CachedPost = {
      id: 'msg-2',
      channel_id: 'ch-1',
      user_id: 'u-1',
      message: 'reply',
      create_at: Date.now(),
      root_id: 'msg-1',
      reply_count: 3,
      edited_at: Date.now(),
    }
    expect(p.root_id).toBe('msg-1')
    expect(p.reply_count).toBe(3)
    expect(p.edited_at).toBeTruthy()
  })
})
